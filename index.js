import express from "express";
import { Client, GatewayIntentBits, Partials } from "discord.js";
import http from "http";
import WebSocket from "ws";

const app = express();
const PORT = 3000;

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

// --- WebSocket Server for live updates ---
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

  // Map activities
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

  // Custom status
  const customStatus = newPresence.activities.find(a => a.type === 4);
  const statusData = {
    status: newPresence.status,
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

  // Broadcast live update
  broadcastUpdate(userId, statusData);
});

// --- Discord Bot Commands ---
client.on("messageCreate", async msg => {
  if (!msg.guild || msg.author.bot) return;

  const prefix = "!";
  if (!msg.content.startsWith(prefix)) return;

  const args = msg.content.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  if (command === "ping") {
    msg.reply("Pong!");
  }

  if (command === "status") {
    const userId = args[0] || msg.author.id;
    const data = presenceCache.get(userId);
    if (!data) return msg.reply("User not found in cache.");
    msg.reply(`User ${data.username}#${data.discriminator} is ${data.status}`);
  }
});

// --- Login Discord Bot ---
client.login("MTQzNDMxMDMxNzAwMDg4NDQxNw.GFSrCc.H5TGjcvV1llVBR26EhHAzW0-YDIeK2Obhp2bTI");

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

// Start server with WebSocket
server.listen(PORT, "0.0.0.0", () => {
  console.log(`API + WebSocket running at http://0.0.0.0:${PORT}`);
});
