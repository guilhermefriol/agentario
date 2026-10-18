"use strict";

const path = require("node:path");
const { createHash } = require("node:crypto");

const OWNER_ID = "friol";

// Nomes fictícios: o personagem de cada sessão é escolhido por hash (estável entre reinícios).
const NAMES = [
  "Ana", "Bento", "Cecília", "Davi", "Elisa", "Fábio", "Gabriela", "Heitor", "Isadora", "Joaquim",
  "Lara", "Miguel", "Nina", "Otávio", "Paula", "Rafael", "Sofia", "Tiago", "Valentina", "Vicente",
  "Alice", "Caio", "Helena", "Lucas", "Marina", "Pedro", "Clara", "Renato", "Bianca", "Gustavo",
];

// Rótulo de tarefa vem só desta allowlist — nunca de texto do transcript.
const TASK_LABELS = {
  Bash: "Rodando comando",
  Edit: "Editando arquivo",
  MultiEdit: "Editando arquivo",
  Write: "Editando arquivo",
  NotebookEdit: "Editando arquivo",
  Read: "Lendo código",
  Grep: "Lendo código",
  Glob: "Lendo código",
  WebSearch: "Pesquisando",
  WebFetch: "Pesquisando",
  Agent: "Delegando",
  Task: "Delegando",
};
const DEFAULT_TASK = "Trabalhando";
const CODEX_COMMAND = /\bcodex\s+exec\b/;
const CODEX_VERDICT = /veredito\W{0,12}(aprovar|revisar|bloquear)/i;

const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const nameFor = (key) => NAMES[parseInt(hash(key).slice(0, 8), 16) % NAMES.length];
const taskFor = (toolName) => (toolName && TASK_LABELS[toolName]) || DEFAULT_TASK;

const parseTime = (value) => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

const contentBlocks = (record) => {
  const content = record.message && record.message.content;
  return Array.isArray(content) ? content.filter((b) => b && typeof b === "object") : [];
};

const toolResultText = (block) => {
  if (typeof block.content === "string") return block.content;
  if (!Array.isArray(block.content)) return "";
  return block.content
    .map((part) => (part && typeof part.text === "string" ? part.text : ""))
    .join("\n");
};

const safeRole = (value) =>
  typeof value === "string"
    ? value.replace(/[^\p{L}\p{N} _-]/gu, "").trim().slice(0, 40) || "Estagiário"
    : "Estagiário";

/** Estado de um turno (sessão ou subagente) derivado dos registros do transcript. */
const createTurn = () => ({
  cwd: null,
  lastEventAt: null,
  working: false,
  lastTool: null,
  pending: new Map(), // tool_use id → nome da ferramenta
  codexPending: new Set(),
});

function applyToTurn(turn, record, onVerdict) {
  const at = parseTime(record.timestamp);
  if (typeof record.cwd === "string" && record.cwd) turn.cwd = record.cwd;

  if (record.type === "system" && record.subtype === "turn_duration") {
    turn.working = false;
    turn.pending.clear();
    if (at) turn.lastEventAt = Math.max(turn.lastEventAt ?? 0, at);
    return;
  }
  if (record.type !== "user" && record.type !== "assistant") return;
  if (at) turn.lastEventAt = Math.max(turn.lastEventAt ?? 0, at);

  const blocks = contentBlocks(record);
  if (record.type === "user") {
    const results = blocks.filter((b) => b.type === "tool_result");
    for (const block of results) {
      turn.pending.delete(block.tool_use_id);
      if (turn.codexPending.delete(block.tool_use_id)) {
        const match = CODEX_VERDICT.exec(toolResultText(block));
        if (match && onVerdict) onVerdict(match[1].toLowerCase(), at);
      }
    }
    if (results.length === 0 && record.isMeta !== true) {
      turn.working = true;
      turn.lastTool = null;
    }
    return;
  }

  for (const block of blocks) {
    if (block.type !== "tool_use" || typeof block.id !== "string") continue;
    const name = typeof block.name === "string" ? block.name : "";
    turn.pending.set(block.id, name);
    turn.lastTool = name;
    const command = block.input && typeof block.input.command === "string" ? block.input.command : "";
    if (name === "Bash" && CODEX_COMMAND.test(command)) turn.codexPending.add(block.id);
  }
  const stopReason = record.message && record.message.stop_reason;
  if (stopReason === "end_turn" && turn.pending.size === 0) turn.working = false;
  else if (stopReason === "tool_use" || turn.pending.size > 0) turn.working = true;
}

/**
 * Estado global: projetos (salas), sessões, estagiários e fiscais.
 * Puro — não toca no disco; o watcher alimenta via `ingest*`.
 */
function createState(config) {
  const projects = new Map(); // cwd → { id, folder }
  const sessions = new Map(); // sessionId → turn
  const interns = new Map(); // agentFileId → { turn, sessionId, toolUseId, role }
  const fiscals = new Map(); // cwd → { verdict, at }

  const projectSettings = (cwd) => config.projects[path.basename(cwd)] || null;
  const isHidden = (cwd) => projectSettings(cwd)?.hidden === true;

  function registerProject(cwd) {
    if (!cwd || projects.has(cwd)) return;
    projects.set(cwd, { id: `p-${hash(cwd).slice(0, 10)}`, folder: path.basename(cwd) });
  }

  function ingestSession(sessionId, record) {
    let turn = sessions.get(sessionId);
    if (!turn) sessions.set(sessionId, (turn = createTurn()));
    applyToTurn(turn, record, (verdict, at) => {
      if (turn.cwd) fiscals.set(turn.cwd, { verdict, at: at ?? Date.now() });
    });
    registerProject(turn.cwd);
  }

  function ingestIntern(agentFileId, info, record) {
    let intern = interns.get(agentFileId);
    if (!intern) {
      intern = {
        turn: createTurn(),
        sessionId: info.sessionId,
        toolUseId: typeof info.toolUseId === "string" ? info.toolUseId : null,
        role: safeRole(info.agentType),
      };
      interns.set(agentFileId, intern);
    }
    applyToTurn(intern.turn, record, null);
    registerProject(intern.turn.cwd);
  }

  function projectLabel(cwd) {
    const project = projects.get(cwd);
    const settings = projectSettings(cwd);
    if (settings?.label) return settings.label;
    return config.showRealNames ? project.folder : `Sala ${project.id.slice(2, 6)}`;
  }

  function taskLabel(cwd, toolName) {
    if (!config.showTasks || projectSettings(cwd)?.hideTasks) return DEFAULT_TASK;
    return taskFor(toolName);
  }

  /** Visão pronta para o protocolo: só labels, nomes fictícios, enums e timestamps. */
  function snapshot(now = Date.now()) {
    const idleFallbackMs = config.idleFallbackSeconds * 1000;
    const presenceMs = config.presenceHours * 3600 * 1000;
    const activeMs = config.activeWindowSeconds * 1000;
    const fiscalMs = config.fiscalMinutes * 60 * 1000;

    const rooms = [...projects.entries()]
      .filter(([cwd]) => !isHidden(cwd))
      .map(([cwd, project]) => ({ id: project.id, label: projectLabel(cwd), cwd }));
    const roomByCwd = new Map(rooms.map((room) => [room.cwd, room]));

    const agents = [
      { id: OWNER_ID, name: "Friol", kind: "owner", role: "Dono", projectId: null, working: false, task: null, updatedAt: null },
    ];

    for (const [sessionId, turn] of sessions) {
      const room = turn.cwd && roomByCwd.get(turn.cwd);
      if (!room || !turn.lastEventAt || now - turn.lastEventAt > presenceMs) continue;
      const working = turn.working && now - turn.lastEventAt <= idleFallbackMs;
      agents.push({
        id: `s-${hash(sessionId).slice(0, 12)}`,
        name: nameFor(sessionId),
        kind: "session",
        role: "Claude",
        projectId: room.id,
        working,
        task: working ? taskLabel(turn.cwd, turn.lastTool) : null,
        updatedAt: turn.lastEventAt,
      });
    }

    for (const [agentFileId, intern] of interns) {
      const turn = intern.turn;
      const room = turn.cwd && roomByCwd.get(turn.cwd);
      if (!room || !turn.lastEventAt) continue;
      const parent = sessions.get(intern.sessionId);
      const parentWaiting = Boolean(intern.toolUseId && parent?.pending.has(intern.toolUseId));
      const recent = turn.working && now - turn.lastEventAt <= activeMs;
      if (!(parentWaiting && now - turn.lastEventAt <= idleFallbackMs) && !recent) continue;
      agents.push({
        id: `i-${hash(agentFileId).slice(0, 12)}`,
        name: `Estagiário ${nameFor(agentFileId)}`,
        kind: "intern",
        role: intern.role,
        projectId: room.id,
        working: true,
        task: taskLabel(turn.cwd, turn.lastTool),
        updatedAt: turn.lastEventAt,
      });
    }

    for (const [cwd, fiscal] of fiscals) {
      const room = roomByCwd.get(cwd);
      if (!room || now - fiscal.at > fiscalMs) continue;
      agents.push({
        id: `f-${room.id.slice(2)}`,
        name: "Fiscal Codex",
        kind: "fiscal",
        role: "Fiscal",
        projectId: room.id,
        working: true,
        task: `Veredito: ${fiscal.verdict}`,
        verdict: fiscal.verdict,
        updatedAt: fiscal.at,
      });
    }

    return {
      rooms: rooms.map(({ id, label }) => ({ id, label })),
      agents,
    };
  }

  return { registerProject, ingestSession, ingestIntern, snapshot };
}

module.exports = { createState, OWNER_ID, TASK_LABELS };
