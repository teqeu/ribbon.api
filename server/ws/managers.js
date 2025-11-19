import WebSocket from "ws";

export class WebSocketManager {
  constructor(server, presenceEvents, presenceCache) {
    this.wss = new WebSocket.Server({ server });
    this.subscriptions = new Map();
    this.presenceCache = presenceCache;

    this.wss.on("connection", ws => {
      ws.on("message", msg => {
        try {
          const { action, userId, guildId } = JSON.parse(msg);
          if (action === "subscribeUser" && userId) this.subscribe(ws, userId);
          if (action === "unsubscribeUser" && userId) this.unsubscribe(ws, userId);
          if (action === "subscribeGuild" && guildId) this.subscribeGuild(ws, guildId);
          if (action === "unsubscribeGuild" && guildId) this.unsubscribeGuild(ws, guildId);
        } catch (e) {
          console.error("Invalid WS message", e);
        }
      });

      ws.on("close", () => {
        for (const subs of this.subscriptions.values()) subs.delete(ws);
      });
    });

    presenceEvents.on("presenceUpdated", (userId, data) => this.broadcast(userId, data));
  }

  subscribe(ws, userId) {
    if (!this.subscriptions.has(userId)) this.subscriptions.set(userId, new Set());
    this.subscriptions.get(userId).add(ws);
    const data = this.presenceCache.get(userId);
    if (data) ws.send(JSON.stringify({ userId, data }));
  }

  unsubscribe(ws, userId) { this.subscriptions.get(userId)?.delete(ws); }

  subscribeGuild(ws, guildId) {
    if (!this.subscriptions.has(guildId)) this.subscriptions.set(guildId, new Set());
    this.subscriptions.get(guildId).add(ws);
  }

  unsubscribeGuild(ws, guildId) { this.subscriptions.get(guildId)?.delete(ws); }

  broadcast(userId, data) {
    const subs = this.subscriptions.get(userId) || new Set();
    subs.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ userId, data })));
  }

  broadcastGuild(guildId, data) {
    const subs = this.subscriptions.get(guildId) || new Set();
    subs.forEach(ws => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ guildId, data })));
  }
}
