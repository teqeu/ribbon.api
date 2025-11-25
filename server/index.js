import express from "express";
import http from "http";
import dotenv from "dotenv";
import { EventEmitter } from "events";
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";
import { WebSocketManager } from "./ws/managers.js";

dotenv.config();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS?.split(",") || [];
const API_URL = process.env.API_URL || "https://agenda-thesaurus-passive-boards.trycloudflare.com/";

class PresenceEvents extends EventEmitter {}
const presenceEvents = new PresenceEvents();

class PresenceCache {
  constructor(ttl = 300_000) {
    this.store = new Map();
    this.ttl = ttl;
  }

  set(id, data) {
    const version = (this.store.get(id)?.version || 0) + 1;
    const payload = { ...data, version, timestamp: Date.now() };
    this.store.set(id, payload);
    setTimeout(() => this.store.delete(id), this.ttl);
    return payload;
  }

  get(id) { return this.store.get(id) || null; }
  clear() { this.store.clear(); }
  all(ids = []) { return ids.length ? ids.map(id => this.get(id) || null) : Array.from(this.store.values()); }
  size() { return this.store.size; }
}

const presenceCache = new PresenceCache();

const app = express();
app.use(express.json());
const server = http.createServer(app);

const wsManager = new WebSocketManager(server, presenceEvents, presenceCache);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel]
});

function parsePresence(member) {
  const user = member.user;
  const p = member.presence;

  const badges = user.flags?.toArray() || [];
  const badgeLinks = badges.map(b => BADGE_IMAGES[b]).filter(Boolean);

  const activities = p?.activities.map(a => ({
    name: a.name,
    type: a.type,
    details: a.details,
    state: a.state,
    applicationId: a.applicationId,
    timestamps: a.timestamps ? { start: a.timestamps.start, end: a.timestamps.end } : null,
    assets: a.assets
      ? {
          largeImage: a.assets.largeImage
            ? `https://cdn.discordapp.com/app-assets/${a.applicationId}/${a.assets.largeImage}.png`
            : null,
          smallImage: a.assets.smallImage
            ? `https://cdn.discordapp.com/app-assets/${a.applicationId}/${a.assets.smallImage}.png`
            : null,
          largeText: a.assets.largeText,
          smallText: a.assets.smallText
        }
      : null
  })) || [];

  const customStatus = p?.activities.find(a => a.type === 4);
  const status = p?.status || "offline";

  return {
    status,
    statusImage: STATUS_IMAGES[status] || STATUS_IMAGES.offline,
    username: user.username,
    discriminator: user.discriminator,
    avatarHash: user.avatar,
    badges,
    badgeLinks,
    customStatus: customStatus ? { text: customStatus.state, emoji: customStatus.emoji } : null,
    activities,
    updatedAt: Date.now()
  };
}

client.on("presenceUpdate", (oldP, newP) => {
  const userId = newP.user.id;
  const data = parsePresence(newP);
  const cached = presenceCache.set(userId, data);
  presenceEvents.emit("presenceUpdated", userId, cached);
});

client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;
  if (!msg.content.startsWith("!")) return;

  const [command, ...args] = msg.content.slice(1).trim().split(/\s+/);

  try {
    switch (command.toLowerCase()) {
      case "ping":
        return msg.reply("Pong!");
      case "status": {
        const id = args[0] || msg.author.id;
        const data = presenceCache.get(id);
        return msg.reply(data ? `${data.username}#${data.discriminator} is ${data.status}` : "User not cached.");
      }
      case "clearcache":
        if (!ADMIN_IDS.includes(msg.author.id)) return;
        presenceCache.clear();
        return msg.reply("Cache cleared.");
      case "cacheall":
        if (!ADMIN_IDS.includes(msg.author.id)) return;
        msg.reply("Caching all guild members...");
        for (const guild of client.guilds.cache.values()) {
          const members = await guild.members.fetch({ withPresences: true });
          for (const member of members.values()) {
            const data = parsePresence(member);
            presenceCache.set(member.user.id, data);
            wsManager.broadcast(member.user.id, data);
            wsManager.broadcastGuild(guild.id, data);
          }
        }
        msg.reply(`Cached ${presenceCache.size()} users.`);
        break;
    }
  } catch (e) {
    console.error("Message command failed", e);
  }
});

app.get("/users/:id", (req, res) => {
  const data = presenceCache.get(req.params.id);
  return data ? res.json(data) : res.status(404).json({ error: "User not found" });
});

app.get("/users", (req, res) => {
  const ids = (req.query.ids || "").split(",");
  return res.json(presenceCache.all(ids));
});

app.get("/users/count", (req, res) => res.json({ total: presenceCache.size() }));

app.get("/users/:id/activities", (req, res) => {
  const data = presenceCache.get(req.params.id);
  if (!data) return res.status(404).json({ error: "User not found" });

  const images = data.activities
    .filter(a => a.assets?.largeImage)
    .map(a => ({
      name: a.name,
      largeImage: a.assets.largeImage,
      smallImage: a.assets.smallImage
    }));

  res.json(images);
});

app.get("/health", (req, res) => res.json({ status: "ok", usersCached: presenceCache.size() }));

const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

async function registerCommands() {
  const whoisCommand = new SlashCommandBuilder()
    .setName("whois")
    .setDescription("Get user presence info")
    .addUserOption(opt => opt.setName("user").setDescription("User to look up").setRequired(true));

  await rest.put(Routes.applicationCommands(client.user.id), { body: [whoisCommand.toJSON()] });
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "whois") {
    const user = interaction.options.getUser("user");
    const data = presenceCache.get(user.id);
    if (!data) return interaction.reply({ content: "User not cached.", ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle(`${user.username}#${user.discriminator}`)
      .setThumbnail(user.displayAvatarURL())
      .setColor(data?.status === "online" ? 0x00ff00 : 0xff0000)
      .addFields(
        { name: "Status", value: data.status, inline: true },
        { name: "Custom Status", value: data.customStatus?.text || "None", inline: true },
        { name: "Badges", value: data.badges.length ? data.badges.join(", ") : "None", inline: true },
        { name: "API", value: `[Link](${API_URL}/users/${user.id})` }
      );

    if (data.badgeLinks.length) {
      embed.addFields({ name: "Badge Images", value: data.badgeLinks.join("\n") });
    }

    if (data.activities.length) {
      for (const activity of data.activities) {
        if (activity.assets?.largeImage) {
          embed.addFields({
            name: `🎮 ${activity.name}`,
            value: activity.details || activity.state || "No details",
            inline: false
          });
          embed.setImage(activity.assets.largeImage);
        }
      }
    }

    embed.setImage(data.statusImage); 

    await interaction.reply({ embeds: [embed] });
  }
});

client.once("ready", async () => {
  console.log(`${client.user.tag} is online.`);
  await registerCommands();
});

client.login(BOT_TOKEN);
server.listen(PORT, () => console.log(`API + WebSocket running on port ${PORT}`));
