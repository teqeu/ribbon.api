// index.js
import express from "express";
import { Client, GatewayIntentBits } from "discord.js";

const app = express();
const PORT = 3000;

// Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers
    ]
});

// In-memory cache for presence
const presenceCache = new Map();

// Listen for presence updates
client.on("presenceUpdate", (oldPresence, newPresence) => {
    const user = newPresence.user;
    const userId = user.id;

    const activities = newPresence.activities.map(a => ({
        name: a.name,
        type: a.type,
        details: a.details,
        state: a.state,
        applicationId: a.applicationId,
        assets: a.assets
            ? {
                  largeImage: a.assets.largeImage,
                  smallImage: a.assets.smallImage,
                  largeText: a.assets.largeText,
                  smallText: a.assets.smallText
              }
            : null
    }));

    presenceCache.set(userId, {
        status: newPresence.status,
        username: user.username,
        discriminator: user.discriminator,
        avatarHash: user.avatar,
        activities: activities,
        updatedAt: Date.now()
    });
});

// Login Discord bot
client.login("MTQzNDMxMDMxNzAwMDg4NDQxNw.GFSrCc.H5TGjcvV1llVBR26EhHAzW0-YDIeK2Obhp2bTI"); // Replace with your bot token

// REST endpoint: single user
app.get("/users/:id", (req, res) => {
    const userId = req.params.id;
    const data = presenceCache.get(userId);
    if (!data) return res.status(404).json({ error: "User not found" });
    res.json(data);
});

// REST endpoint: multiple users
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

// Start server on all network interfaces
app.listen(PORT, "0.0.0.0", () => {
    console.log(`API running at http://0.0.0.0:${PORT}`);
});
