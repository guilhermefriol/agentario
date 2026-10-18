"use strict";

const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { WebSocketServer } = require("ws");
const { loadConfig } = require("./config");
const { createState, OWNER_ID } = require("./state");
const { createWatcher } = require("./watcher");

const ADAPTER_PORT = parseInt(process.env.AGENTARIO_ADAPTER_PORT || "18790", 10);
const MAIN_KEY = "main";
const AGENTARIO_PROTOCOL_VERSION = 1;
const POLL_MS = 2000;
const DISCOVER_MS = 10000;
const MODELS = [{ id: "claude-code", name: "Claude Code", provider: "anthropic" }];
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

// Única lista de métodos atendidos. Todo o resto é recusado: o Agentário só lê.
const READ_METHODS = [
  "agents.list",
  "sessions.list",
  "sessions.preview",
  "status",
  "chat.history",
  "skills.status",
  "models.list",
  "config.get",
  "agents.files.get",
  "exec.approvals.get",
  "cron.list",
  "agent.wait",
  "wake",
];

const randomId = () => randomUUID().replace(/-/g, "");
const sessionKeyFor = (agentId) => `agent:${agentId}:${MAIN_KEY}`;
const resOk = (id, payload) => ({ type: "res", id, ok: true, payload: payload ?? {} });
const resErr = (id, code, message) => ({ type: "res", id, ok: false, error: { code, message } });

/** Valida Host/Origin do upgrade: só conexões vindas da própria máquina. */
function isLocalRequest(headers) {
  const host = typeof headers.host === "string" ? headers.host : "";
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  return LOCAL_HOST.test(host) && (!origin || LOCAL_ORIGIN.test(origin));
}

const agentPayload = (agent, roomsById) => ({
  id: agent.id,
  name: agent.name,
  workspace: agent.projectId ? `sala:${roomsById.get(agent.projectId) ?? ""}` : "centro",
  identity: { name: agent.name, emoji: agent.kind === "fiscal" ? "📋" : "🤖" },
  role: agent.role,
  // Campos próprios do Agentário: a tela /tv usa estes, não infere por preview.
  agentario: {
    kind: agent.kind,
    status: agent.working ? "working" : "idle",
    task: agent.task,
    room: agent.projectId ? roomsById.get(agent.projectId) ?? null : null,
    verdict: agent.verdict ?? null,
  },
});

function recentSessions(snapshot) {
  const recent = snapshot.agents
    .filter((agent) => agent.updatedAt)
    .map((agent) => ({ key: sessionKeyFor(agent.id), updatedAt: agent.updatedAt }));
  return {
    recent,
    byAgent: snapshot.agents.map((agent) => ({
      agentId: agent.id,
      recent: recent.filter((entry) => entry.key === sessionKeyFor(agent.id)),
    })),
  };
}

/** Responde a um método. `getSnapshot` devolve a visão atual do estado. */
function handleMethod(method, params, id, getSnapshot) {
  const p = params || {};
  if (!READ_METHODS.includes(method)) {
    return resErr(id, "read_only", "O Agentário é somente leitura.");
  }
  const snapshot = getSnapshot();
  const roomsById = new Map(snapshot.rooms.map((room) => [room.id, room.label]));
  const agentsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));

  switch (method) {
    case "agents.list":
      return resOk(id, {
        defaultId: OWNER_ID,
        mainKey: MAIN_KEY,
        agents: snapshot.agents.map((agent) => agentPayload(agent, roomsById)),
      });

    case "sessions.list":
      return resOk(id, {
        sessions: snapshot.agents.map((agent) => ({
          key: sessionKeyFor(agent.id),
          agentId: agent.id,
          updatedAt: agent.updatedAt,
          displayName: "Main",
          origin: { label: agent.name, provider: "claude-code" },
          model: MODELS[0].id,
          modelProvider: "claude-code",
        })),
      });

    case "sessions.preview": {
      const keys = Array.isArray(p.keys) ? p.keys : [];
      const previews = keys.map((key) => {
        const agentId = typeof key === "string" ? key.split(":")[1] : "";
        const agent = agentsById.get(agentId);
        if (!agent || !agent.task) return { key, status: "empty", items: [] };
        return {
          key,
          status: "ok",
          items: [{ role: "assistant", text: agent.task, timestamp: agent.updatedAt ?? Date.now() }],
        };
      });
      return resOk(id, { ts: Date.now(), previews });
    }

    case "status":
      return resOk(id, { sessions: recentSessions(snapshot) });

    case "chat.history": {
      const sessionKey = typeof p.sessionKey === "string" ? p.sessionKey : sessionKeyFor(OWNER_ID);
      return resOk(id, { sessionKey, messages: [] });
    }

    case "skills.status":
      return resOk(id, { skills: [] });

    case "models.list":
      return resOk(id, { models: MODELS });

    case "config.get":
      return resOk(id, {
        config: { gateway: { reload: { mode: "hot" } } },
        hash: "agentario",
        exists: true,
        path: "",
      });

    case "agents.files.get":
      return resOk(id, { file: { missing: true } });

    case "exec.approvals.get":
      return resOk(id, {
        path: "",
        exists: true,
        hash: "agentario",
        file: { version: 1, defaults: { security: "full", ask: "off", autoAllowSkills: true }, agents: {} },
      });

    case "cron.list":
      return resOk(id, { jobs: [] });

    case "agent.wait":
      return resOk(id, { status: "done" });

    case "wake":
      return resOk(id, { ok: true });

    default:
      return resErr(id, "read_only", "O Agentário é somente leitura.");
  }
}

const agentSignature = (agent) => `${agent.working ? 1 : 0}|${agent.task ?? ""}`;

/**
 * Compara dois snapshots e devolve os eventos de protocolo:
 * `chat delta` ao começar/mudar de tarefa, `chat final` ao parar ou sair,
 * e `presence` quando a lista de agentes muda.
 */
function diffEvents(previous, next, runIds) {
  const events = [];
  const prevById = new Map(previous.agents.map((agent) => [agent.id, agent]));
  const nextById = new Map(next.agents.map((agent) => [agent.id, agent]));

  const chat = (agent, state, text) => {
    const sessionKey = sessionKeyFor(agent.id);
    let runId = runIds.get(agent.id);
    if (!runId) runIds.set(agent.id, (runId = randomId()));
    const payload = { runId, sessionKey, state, message: { role: "assistant", content: text } };
    if (state === "final") {
      payload.stopReason = "end_turn";
      runIds.delete(agent.id);
    }
    events.push({ type: "event", event: "chat", payload });
  };

  for (const agent of next.agents) {
    const before = prevById.get(agent.id);
    if (agent.working && (!before || agentSignature(before) !== agentSignature(agent))) {
      chat(agent, "delta", agent.task);
    } else if (!agent.working && before?.working) {
      chat(agent, "final", before.task ?? "");
    }
  }
  for (const before of previous.agents) {
    if (!nextById.has(before.id) && before.working) chat(before, "final", before.task ?? "");
  }

  const membership = (snapshot) =>
    snapshot.agents.map((agent) => `${agent.id}:${agent.projectId}`).sort().join(",") +
    "|" +
    snapshot.rooms.map((room) => `${room.id}:${room.label}`).sort().join(",");
  if (events.length > 0 || membership(previous) !== membership(next)) {
    events.push({ type: "event", event: "presence", payload: { sessions: recentSessions(next) } });
  }
  return events;
}

function startAdapter({ config = loadConfig(), port = ADAPTER_PORT } = {}) {
  const state = createState(config);
  const watcher = createWatcher({ config, state });
  const sockets = new Set();
  const runIds = new Map();

  watcher.discover();
  watcher.poll();
  let current = state.snapshot();

  const broadcast = (frame) => {
    for (const socket of sockets) socket.sendEvent(frame);
  };

  const pollTimer = setInterval(() => {
    watcher.poll();
    const next = state.snapshot();
    for (const event of diffEvents(current, next, runIds)) broadcast(event);
    current = next;
  }, POLL_MS);
  const discoverTimer = setInterval(() => watcher.discover(), DISCOVER_MS);

  const httpServer = http.createServer((req, res) => {
    res.writeHead(isLocalRequest(req.headers) ? 200 : 403, { "Content-Type": "text/plain" });
    res.end("Agentário — adaptador Claude Code (somente leitura)\n");
  });

  const wss = new WebSocketServer({
    server: httpServer,
    verifyClient: (info) => isLocalRequest(info.req.headers),
  });

  wss.on("connection", (ws) => {
    let connected = false;
    let seq = 0;
    const send = (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    };
    const socket = { sendEvent: (frame) => connected && send({ ...frame, seq: seq++ }) };
    sockets.add(socket);
    send({ type: "event", event: "connect.challenge", payload: { nonce: randomId() } });

    ws.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(raw.toString("utf8"));
      } catch {
        return;
      }
      if (!frame || typeof frame !== "object" || frame.type !== "req") return;
      const { id, method, params } = frame;
      if (typeof id !== "string" || typeof method !== "string") return;

      if (method === "connect") {
        connected = true;
        send(
          resOk(id, {
            type: "hello-ok",
            protocol: 3,
            adapterType: "demo",
            agentario: { version: AGENTARIO_PROTOCOL_VERSION },
            features: { methods: READ_METHODS, events: ["chat", "presence", "heartbeat"] },
            snapshot: {
              health: {
                agents: current.agents.map((agent) => ({
                  agentId: agent.id,
                  name: agent.name,
                  isDefault: agent.id === OWNER_ID,
                })),
                defaultAgentId: OWNER_ID,
              },
              sessionDefaults: { mainKey: MAIN_KEY },
            },
            auth: { role: "operator", scopes: ["operator.read"] },
            policy: { tickIntervalMs: 30000 },
          })
        );
        return;
      }
      if (!connected) return send(resErr(id, "not_connected", "Send connect first."));
      try {
        send(handleMethod(method, params, id, () => current));
      } catch {
        send(resErr(id, "internal_error", "Erro interno."));
      }
    });

    ws.on("close", () => sockets.delete(socket));
    ws.on("error", () => sockets.delete(socket));
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[agentario] adaptador em ws://localhost:${port} (somente leitura)`);
    console.log(
      `[agentario] ${current.rooms.length} salas, ${current.agents.length} personagens, ${watcher.trackedFiles} arquivos acompanhados`
    );
  });

  const close = () => {
    clearInterval(pollTimer);
    clearInterval(discoverTimer);
    wss.close();
    httpServer.close();
  };
  return { close, httpServer };
}

if (require.main === module) {
  startAdapter();
}

module.exports = { handleMethod, diffEvents, isLocalRequest, startAdapter, READ_METHODS };
