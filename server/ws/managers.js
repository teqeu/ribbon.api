// websocketManager.smart.js
import WebSocket from "ws";
import Redis from "ioredis";
import { v4 as uuid } from "uuid";


class TokenBucket {
  constructor(rate, burst) {
    this.rate = rate;     
    this.burst = burst;
    this.tokens = burst;
    this.last = Date.now();
  }
  take(cost = 1) {
    const now = Date.now();
    const dt = (now - this.last) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
    this.last = now;
    if (this.tokens >= cost) { this.tokens -= cost; return true; }
    return false;
  }
}

export class WebSocketManager {
  constructor(server, presenceEvents, presenceCache, opts = {}) {
    this.wss = new WebSocket.Server({ server });
    this.presenceCache = presenceCache;
    this.opts = Object.assign({
      redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
      heartbeatInterval: 15000,
      defaultRate: 5,   
      defaultBurst: 20, 
      baseBatchWindow: 40, 
      maxBatchWindow: 500,
      minBatchWindow: 10,
      requireAuth: false,
      verifyToken: null,    
      checkPermissions: null, 
      mlScoreHook: null,   
    }, opts);
    this.redisPub = new Redis(this.opts.redisUrl);
    this.redisSub = new Redis(this.opts.redisUrl);
    this.subscriptions = new Map(); 
    this.socketMeta = new WeakMap();
    this.messageQueues = new Map(); // key => { events: [], timer, adaptiveWindow }
    this.initialize(presenceEvents);
  }

  initialize(presenceEvents) {
    this.wss.on("connection", ws => this.onConnection(ws));
    this.startHeartbeat();

    presenceEvents.on("presenceUpdated", async (userId, data) => {
      const key = `user:${userId}`;
      const event = { key, type: "presence", payload: { userId, data }, ts: Date.now() };
      await this.queueEvent(key, event);
      this.redisPub.publish("ws_events", JSON.stringify(event));
    });

    this.redisSub.subscribe("ws_events");
    this.redisSub.on("message", async (channel, message) => {
      if (channel !== "ws_events") return;
      try {
        const event = JSON.parse(message);
        await this.queueEvent(event.key, event, true); 
      } catch (e) { }
    });
  }

  onConnection(ws) {
    const id = uuid();
    const meta = {
      id,
      lastPong: Date.now(),
      authed: !this.opts.requireAuth,
      bucket: new TokenBucket(this.opts.defaultRate, this.opts.defaultBurst),
      subscriptions: new Set(),
      createdAt: Date.now(),
    };
    this.socketMeta.set(ws, meta);

    ws.on("message", raw => this.handleMessage(ws, raw));
    ws.on("close", () => this.cleanupSocket(ws));
    ws.on("pong", () => meta.lastPong = Date.now());

    ws.send(JSON.stringify({ op: "connectionAck", id }));
  }

  async handleMessage(ws, raw) {
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    const meta = this.socketMeta.get(ws);
    const { action, token, key } = payload;

    if (this.opts.requireAuth && !meta.authed) {
      if (action === "auth" && token && typeof this.opts.verifyToken === "function" && this.opts.verifyToken(token)) {
        meta.authed = true;
        ws.send(JSON.stringify({ op: "authSuccess" }));
      } else {
        ws.send(JSON.stringify({ op: "authFail" }));
        return ws.close();
      }
      return;
    }

    switch (action) {
      case "subscribe":
        if (!key) return;
        if (typeof this.opts.checkPermissions === "function") {
          const allowed = await this.opts.checkPermissions(meta, key);
          if (!allowed) return ws.send(JSON.stringify({ op: "subscribeDenied", key }));
        }
        this.addSubscription(ws, key);
        break;
      case "unsubscribe":
        if (!key) return;
        this.removeSubscription(ws, key);
        break;
      case "ping":
        ws.send(JSON.stringify({ op: "pong", ts: Date.now() }));
        break;
      default:
        break;
    }
  }

  addSubscription(ws, key) {
    if (!this.subscriptions.has(key)) this.subscriptions.set(key, new Set());
    this.subscriptions.get(key).add(ws);
    this.socketMeta.get(ws).subscriptions.add(key);

    const snapshot = this.presenceCache.get?.(key);
    if (snapshot) ws.send(JSON.stringify({ key, snapshot }));
  }

  removeSubscription(ws, key) {
    this.subscriptions.get(key)?.delete(ws);
    this.socketMeta.get(ws).subscriptions.delete(key);
  }

  cleanupSocket(ws) {
    const meta = this.socketMeta.get(ws);
    if (!meta) return;
    for (const key of meta.subscriptions) this.subscriptions.get(key)?.delete(ws);
    this.socketMeta.delete(ws);
  }

  startHeartbeat() {
    setInterval(() => {
      for (const ws of this.wss.clients) {
        const meta = this.socketMeta.get(ws);
        if (!meta) continue;
        if (Date.now() - meta.lastPong > this.opts.heartbeatInterval * 2) return ws.terminate();
        ws.ping();
      }
    }, this.opts.heartbeatInterval);
  }

  async queueEvent(key, event, remote = false) {
    if (!this.messageQueues.has(key)) {
      this.messageQueues.set(key, { events: [], timer: null, adaptiveWindow: this.opts.baseBatchWindow });
    }
    const q = this.messageQueues.get(key);

    if (typeof this.opts.mlScoreHook === "function") {
      try {
        const score = await this.opts.mlScoreHook(event);
        if (score?.dropProbability && Math.random() < score.dropProbability) return;
        if (score?.priority) event.priority = score.priority;
      } catch (e) { }
    }

    q.events.push(event);


    if (q.events.length > 200) q.adaptiveWindow = Math.min(this.opts.maxBatchWindow, q.adaptiveWindow * 1.5);
    else if (q.events.length < 10) q.adaptiveWindow = Math.max(this.opts.minBatchWindow, q.adaptiveWindow * 0.9);

    if (q.timer) return;

    q.timer = setTimeout(() => {
      this.flushQueue(key);
    }, q.adaptiveWindow);
  }

  flushQueue(key) {
    const q = this.messageQueues.get(key);
    if (!q) return;
    const batch = q.events.splice(0, q.events.length);
    clearTimeout(q.timer); q.timer = null;

    batch.sort((a,b) => (b.priority||0) - (a.priority||0));
    const payload = JSON.stringify({ key, events: batch, ts: Date.now() });

    const subs = this.subscriptions.get(key);
    if (!subs || subs.size === 0) return;

    for (const ws of subs) {
      try {
        if (ws.readyState !== WebSocket.OPEN) { subs.delete(ws); continue; }
        const meta = this.socketMeta.get(ws);
        if (!meta.bucket.take(Math.max(1, batch.length))) {
          if (meta.bucket.take(0)) { 
            ws.send(JSON.stringify({ op: "throttle", key, buffered: batch.length }));
          }
          continue;
        }

        if (typeof this.opts.checkPermissions === "function") {
          this.opts.checkPermissions(meta, key)
            .then(ok => { if (ok) ws.send(payload); })
            .catch(() => { /* fail closed: skip */ });
        } else {
          ws.send(payload);
        }
      } catch (e) { subs.delete(ws); }
    }
  }
}
