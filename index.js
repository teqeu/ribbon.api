// index.js
import express from "express";
import { Client, GatewayIntentBits } from "discord.js";

const app = express();
const PORT = 3000;

// Discord bot client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers
    ]
});

// In-memory cache for user presence
const presenceCache = new Map();

// Listen for presence updates
client.on("presenceUpdate", (oldPresence, newPresence) => {
    const userId = newPresence.userId;
    presenceCache.set(userId, {
        status: newPresence.status,
        activities: newPresence.activities.map(a => a.name),
        updatedAt: Date.now()
    });
});

// Login with your bot token
client.login("MTQzNDMxMDMxNzAwMDg4NDQxNw.GFSrCc.H5TGjcvV1llVBR26EhHAzW0-YDIeK2Obhp2bTI"); // Replace this with your Discord bot token

// REST endpoint for single user
app.get("/users/:id", (req, res) => {
    const userId = req.params.id;
    const data = presenceCache.get(userId);
    if (!data) return res.status(404).json({ error: "User not found" });
    res.json(data);
});

// Optional: multi-user endpoint
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

// Start the server
app.listen(PORT, () => {
    console.log(`API running at http://localhost:${PORT}`);
});
