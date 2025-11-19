import express from "express";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import http from "http";
import WebSocket from "ws";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS?.split(",") || [];

const app = express();
app.use(express.json());

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

const presenceCache = new Map();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastUpdate(userId, data) {
  const payload = JSON.stringify({ userId, data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

client.on("presenceUpdate", (oldP, newP) => {
  const user = newP.user;
  const userId = user.id;

  const activities = newP.activities.map(a => ({
    name: a.name,
    type: a.type,
    details: a.details,
    state: a.state,
    applicationId: a.applicationId,
    timestamps: a.timestamps
      ? { start: a.timestamps.start, end: a.timestamps.end }
      : null,
    assets: a.assets
      ? {
          largeImage: a.assets.largeImage,
          smallImage: a.assets.smallImage,
          largeText: a.assets.largeText,
          smallText: a.assets.smallText
        }
      : null
  }));

  const customStatus = newP.activities.find(a => a.type === 4);

  const statusData = {
    status: newP.status || "offline",
    username: user.username,
    discriminator: user.discriminator,
    avatarHash: user.avatar,
    customStatus: customStatus
      ? { text: customStatus.state, emoji: customStatus.emoji }
      : null,
    activities,
    updatedAt: Date.now()
  };

  presenceCache.set(userId, statusData);
  broadcastUpdate(userId, statusData);
});

client.on("messageCreate", async msg => {
  if (msg.author.bot || !msg.guild) return;

  const prefix = "!";
  if (!msg.content.startsWith(prefix)) return;

  const args = msg.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();


  if (command === "status") {
    const id = args[0] || msg.author.id;
    const data = presenceCache.get(id);
    return msg.reply(data ? `${data.username} is ${data.status}` : "User not cached.");
  }

  if (!ADMIN_IDS.includes(msg.author.id)) return;

  if (command === "clearcache") {
    presenceCache.clear();
    return msg.reply("Cache cleared.");
  }

  if (command === "cacheall") {
    msg.reply("Caching all guild members...");

    let count = 0;

    for (const guild of client.guilds.cache.values()) {
      try {
        const members = await guild.members.fetch({ withPresences: true });

        members.forEach(member => {
          const p = member.presence;

          const activities = p?.activities.map(a => ({
            name: a.name,
            type: a.type,
            details: a.details,
            state: a.state,
            applicationId: a.applicationId,
            timestamps: a.timestamps
              ? { start: a.timestamps.start, end: a.timestamps.end }
              : null,
            assets: a.assets
              ? {
                  largeImage: a.assets.largeImage,
                  smallImage: a.assets.smallImage,
                  largeText: a.assets.largeText,
                  smallText: a.assets.smallText
                }
              : null
          })) || [];

          const customStatus = p?.activities.find(a => a.type === 4);

          const statusData = {
            status: p?.status || "offline",
            username: member.user.username,
            discriminator: member.user.discriminator,
            avatarHash: member.user.avatar,
            customStatus: customStatus
              ? { text: customStatus.state, emoji: customStatus.emoji }
              : null,
            activities,
            updatedAt: Date.now()
          };

          presenceCache.set(member.user.id, statusData);
          broadcastUpdate(member.user.id, statusData);
          count++;
        });

      } catch (err) {
        console.log(`Guild fetch failed: ${err.message}`);
      }
    }

    msg.reply(`Cached ${count} users.`);
  }
});

app.get("/users/:id", (req, res) => {
  const data = presenceCache.get(req.params.id);
  if (!data) return res.status(404).json({ error: "User not found" });
  res.json(data);
});

app.get("/users", (req, res) => {
  const ids = (req.query.ids || "").split(",");
  const result = {};

  ids.forEach(id => {
    result[id] = presenceCache.get(id) || null;
  });

  res.json(result);
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    usersCached: presenceCache.size
  });
});

app.get("/users/count", (req, res) => {
  res.json({ total: presenceCache.size });
});

client.login(BOT_TOKEN);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`API + WebSocket running on port ${PORT}`);
});
