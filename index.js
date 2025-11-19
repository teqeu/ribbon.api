import express from "express";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import http from "http";
import WebSocket from "ws";
import path from "path";
import { fileURLToPath } from "url";

// --- Config ---
const PORT = 3000;
const BOT_TOKEN = "MTQzNDMxMDMxNzAwMDg4NDQxNw.GFSrCc.H5TGjcvV1llVBR26EhHAzW0-YDIeK2Obhp2bTI"; // Replace with your bot token
const ADMIN_IDS = ["1270223423594954777"]; // Discord IDs allowed to run admin commands

// --- Express app ---
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// --- Discord Client ---
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

// --- Presence Cache ---
const presenceCache = new Map();

// --- WebSocket Server ---
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastUpdate(userId, data) {
  const payload = JSON.stringify({ userId, data });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

// --- Handle presence updates ---
client.on("presenceUpdate", (oldPresence, newPresence) => {
  const user = newPresence.user;
  const userId = user.id;

  const activities = newPresence.activities.map(a => ({
    name: a.name,
    type: a.type,
    details: a.details,
    state: a.state,
    applicationId: a.applicationId,
    timestamps: a.timestamps ? { start: a.timestamps.start, end: a.timestamps.end } : null,
    assets: a.assets
      ? {
          largeImage: a.assets.largeImage,
          smallImage: a.assets.smallImage,
          largeText: a.assets.largeText,
          smallText: a.assets.smallText
        }
      : null
  }));

  const customStatus = newPresence.activities.find(a => a.type === 4);

  const statusData = {
    status: newPresence.status || "offline",
    username: user.username,
    discriminator: user.discriminator,
    avatarHash: user.avatar,
    customStatus: customStatus
      ? { text: customStatus.state, emoji: customStatus.emoji }
      : null,
    activities: activities.length ? activities : [], // empty array if no activities
    updatedAt: Date.now()
  };

  presenceCache.set(userId, statusData);
  broadcastUpdate(userId, statusData);
});

// --- Discord Bot Commands ---
client.on("messageCreate", async msg => {
  if (!msg.guild || msg.author.bot) return;

  const prefix = "!";
  if (!msg.content.startsWith(prefix)) return;

  const args = msg.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  // --- Basic commands ---
  if (command === "ping") msg.reply("Pong!");

  if (command === "status") {
    const userId = args[0] || msg.author.id;
    const data = presenceCache.get(userId);
    if (!data) return msg.reply("User not found in cache.");
    msg.reply(`User ${data.username}#${data.discriminator} is ${data.status}`);
  }

  // --- Admin-only commands ---
  if (!ADMIN_IDS.includes(msg.author.id)) return;

if (command === "cacheall") {
  msg.reply("Caching all members' presence in all guilds...");
  let total = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      const members = await guild.members.fetch({ withPresences: true });

      members.forEach(member => {
        const user = member.user;
        const presence = member.presence;

        const activities = presence?.activities.map(a => ({
          name: a.name,
          type: a.type,
          details: a.details,
          state: a.state,
          applicationId: a.applicationId,
          timestamps: a.timestamps ? { start: a.timestamps.start, end: a.timestamps.end } : null,
          assets: a.assets
            ? {
                largeImage: a.assets.largeImage,
                smallImage: a.assets.smallImage,
                largeText: a.assets.largeText,
                smallText: a.assets.smallText
              }
            : null
        })) || []; // empty array if no activities

        const customStatus = presence?.activities.find(a => a.type === 4) || null;

        const statusData = {
          status: presence?.status || "offline",
          username: user.username,
          discriminator: user.discriminator,
          avatarHash: user.avatar,
          customStatus: customStatus
            ? { text: customStatus.state, emoji: customStatus.emoji }
            : null,
          activities,
          updatedAt: Date.now()
        };

        presenceCache.set(user.id, statusData);
        broadcastUpdate(user.id, statusData);
        total++;
      });

      await new Promise(res => setTimeout(res, 2000)); // throttle per guild

    } catch (err) {
      console.error(`Failed to fetch guild ${guild.id}:`, err.message);
    }
  }

  msg.reply(`Presence cache updated for ${total} users.`);
}

  if (command === "clearcache") {
    presenceCache.clear();
    msg.reply("Presence cache cleared.");
  }
});

// --- Login Discord Bot ---
client.login(BOT_TOKEN);

// --- REST Endpoints ---
// Single user
app.get("/users/:id", (req, res) => {
  const userId = req.params.id;
  const data = presenceCache.get(userId);
  if (!data) return res.status(404).json({ error: "User not found" });
  res.json(data);
});

// Multiple users
app.get("/users", (req, res) => {
  const ids = (req.query.ids || "").split(",");
  if (!ids.length) return res.status(400).json({ error: "No user IDs provided" });

  const result = {};
  ids.forEach(id => {
    const data = presenceCache.get(id);
    result[id] = data || null;
  });
  res.json(result);
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", usersCached: presenceCache.size });
});

// --- Start server with WebSocket ---
server.listen(PORT, "0.0.0.0", () => {
  console.log(`API + WebSocket running at http://0.0.0.0:${PORT}`);
});
