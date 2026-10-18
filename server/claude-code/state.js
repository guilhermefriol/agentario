"use strict";

const { createHash } = require("node:crypto");
const { locateCwd } = require("./rooms");

const OWNER_ID = "friol";

// Nomes russos (transliterados). Cada personagem ganha um nome único e estável enquanto estiver no prédio.
const NAMES = [
  "Andrei", "Serguei", "Maksim", "Iuri", "Dmitri", "Ivan", "Aleksei", "Nikolai", "Mikhail", "Vladimir",
  "Boris", "Oleg", "Pavel", "Igor", "Fiodor", "Konstantin", "Viktor", "Anatoli", "Grigori", "Leonid",
  "Stanislav", "Timofei", "Vassili", "Ievgueni", "Artiom", "Ruslan", "Kirill", "Arkadi", "Gennadi", "Valentin",
  "Anastassia", "Natacha", "Olga", "Svetlana", "Tatiana", "Irina", "Iekaterina", "Liudmila", "Dária", "Ksenia",
  "Ielena", "Marina", "Galina", "Vera", "Nadejda", "Sofia", "Polina", "Alina", "Ievguenia", "Valentina",
  "Roman", "Iaroslav", "Bogdan", "Matvei", "Lev", "Egor", "Semion", "Vadim", "Gleb", "Danil",
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
  firstEventAt: null,
  lastEventAt: null,
  working: false,
  lastTool: null,
  pending: new Map(), // tool_use id → nome da ferramenta
  codexPending: new Set(),
});

function applyToTurn(turn, record, onVerdict) {
  const at = parseTime(record.timestamp);
  if (typeof record.cwd === "string" && record.cwd) turn.cwd = record.cwd;
  const touch = () => {
    if (!at) return;
    turn.lastEventAt = Math.max(turn.lastEventAt ?? 0, at);
    turn.firstEventAt = Math.min(turn.firstEventAt ?? at, at);
  };

  if (record.type === "system" && record.subtype === "turn_duration") {
    turn.working = false;
    turn.pending.clear();
    touch();
    return;
  }
  if (record.type !== "user" && record.type !== "assistant") return;
  touch();

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

/** Nomes únicos e estáveis: o mesmo personagem mantém o nome enquanto estiver presente. */
function createNameRegistry() {
  const byId = new Map();
  return {
    sync(ids) {
      const present = new Set(ids);
      for (const id of byId.keys()) if (!present.has(id)) byId.delete(id);
      const used = new Set(byId.values());
      for (const id of ids) {
        if (byId.has(id)) continue;
        const start = parseInt(hash(id).slice(0, 8), 16) % NAMES.length;
        let name = null;
        for (let step = 0; step < NAMES.length && !name; step += 1) {
          const candidate = NAMES[(start + step) % NAMES.length];
          if (!used.has(candidate)) name = candidate;
        }
        for (let n = 2; !name; n += 1) {
          const candidate = `${NAMES[start]} ${n}`;
          if (!used.has(candidate)) name = candidate;
        }
        byId.set(id, name);
        used.add(name);
      }
    },
    nameOf: (id) => byId.get(id),
  };
}

/**
 * Estado global: salas (pastas de projeto), sessões, subagentes e fiscais.
 * Puro — não toca no disco; o watcher alimenta via `setProjects`/`ingest*`.
 */
function createState(config, roots) {
  const projects = new Map(); // pasta → { key, id, staff: string[] }
  const sessions = new Map(); // sessionId → turn
  const interns = new Map(); // agentFileId → { turn, sessionId, toolUseId, agentType }
  const fiscals = new Map(); // pasta → { verdict, at }
  const names = createNameRegistry();

  const settingsOf = (key) => config.projects[key] || null;

  function setProjects(list) {
    const next = new Set();
    for (const { key, staff } of list) {
      next.add(key);
      projects.set(key, { key, id: `p-${hash(key).slice(0, 10)}`, staff: staff || [] });
    }
    for (const key of projects.keys()) if (!next.has(key)) projects.delete(key);
  }

  function ingestSession(sessionId, record) {
    let turn = sessions.get(sessionId);
    if (!turn) sessions.set(sessionId, (turn = createTurn()));
    applyToTurn(turn, record, (verdict, at) => {
      const place = locateCwd(turn.cwd, roots);
      if (place.kind === "room") fiscals.set(place.key, { verdict, at: at ?? Date.now() });
    });
  }

  function ingestIntern(agentFileId, info, record) {
    let intern = interns.get(agentFileId);
    if (!intern) {
      intern = {
        turn: createTurn(),
        sessionId: info.sessionId,
        toolUseId: typeof info.toolUseId === "string" ? info.toolUseId : null,
        agentType: typeof info.agentType === "string" ? info.agentType : "",
      };
      interns.set(agentFileId, intern);
    }
    applyToTurn(intern.turn, record, null);
  }

  function roomLabel(project) {
    const label = settingsOf(project.key)?.label;
    if (label) return label;
    return config.showRealNames ? project.key : `Sala ${project.id.slice(2, 6)}`;
  }

  /** Política de tarefas da sala: publico → rótulo; interno → genérico; oculto → nada. */
  function taskLabel(key, toolName) {
    const policy = key ? settingsOf(key)?.tasks ?? "publico" : "publico";
    if (!config.showTasks || policy === "oculto") return null;
    if (policy === "interno") return DEFAULT_TASK;
    return taskFor(toolName);
  }

  /** Visão pronta para o protocolo: só labels, nomes fictícios, enums e timestamps. */
  function snapshot(now = Date.now()) {
    const idleFallbackMs = config.idleFallbackSeconds * 1000;
    const presenceMs = config.presenceHours * 3600 * 1000;
    const activeMs = config.activeWindowSeconds * 1000;
    const fiscalMs = config.fiscalMinutes * 60 * 1000;

    const visible = [...projects.values()].filter((project) => settingsOf(project.key)?.hidden !== true);
    const roomByKey = new Map(visible.map((project) => [project.key, project]));
    const people = [];

    // place: { kind: "room", key } | { kind: "center" }; devolve null se a sala está oculta/fora.
    const placeOf = (cwd) => {
      const place = locateCwd(cwd, roots);
      if (place.kind === "center") return { roomKey: null };
      if (place.kind === "room" && roomByKey.has(place.key)) return { roomKey: place.key };
      return null;
    };

    for (const [sessionId, turn] of sessions) {
      if (!turn.lastEventAt || now - turn.lastEventAt > presenceMs) continue;
      const place = placeOf(turn.cwd);
      if (!place) continue;
      const working = turn.working && now - turn.lastEventAt <= idleFallbackMs;
      people.push({
        id: `s-${hash(sessionId).slice(0, 12)}`,
        kind: "session",
        role: "Claude",
        roomKey: place.roomKey,
        working,
        task: working ? taskLabel(place.roomKey, turn.lastTool) : null,
        updatedAt: turn.lastEventAt,
      });
    }

    // Subagentes ativos; os do tipo de um cadastrado da sala viram o próprio funcionário.
    const activeRuns = [];
    for (const [agentFileId, intern] of interns) {
      const turn = intern.turn;
      if (!turn.lastEventAt) continue;
      const parent = sessions.get(intern.sessionId);
      const place = placeOf(turn.cwd ?? parent?.cwd);
      if (!place) continue;
      const parentWaiting = Boolean(intern.toolUseId && parent?.pending.has(intern.toolUseId));
      const recent = turn.working && now - turn.lastEventAt <= activeMs;
      if (!(parentWaiting && now - turn.lastEventAt <= idleFallbackMs) && !recent) continue;
      activeRuns.push({ agentFileId, intern, roomKey: place.roomKey });
    }
    activeRuns.sort((a, b) => (a.intern.turn.firstEventAt ?? 0) - (b.intern.turn.firstEventAt ?? 0));

    const staffWork = new Map(); // "pasta\u0000nome" → run que representa o funcionário
    for (const run of activeRuns) {
      const project = run.roomKey ? roomByKey.get(run.roomKey) : null;
      const staffName = project?.staff.find(
        (name) => name.toLowerCase() === run.intern.agentType.toLowerCase(),
      );
      const staffKey = staffName ? `${run.roomKey}\u0000${staffName}` : null;
      if (staffKey && !staffWork.has(staffKey)) {
        staffWork.set(staffKey, run); // execução mais antiga = o funcionário
        continue;
      }
      const role = safeRole(run.intern.agentType);
      people.push({
        id: `i-${hash(run.agentFileId).slice(0, 12)}`,
        kind: "intern",
        role: staffKey ? `${role} (reforço)` : role,
        roomKey: run.roomKey,
        working: true,
        task: taskLabel(run.roomKey, run.intern.turn.lastTool),
        updatedAt: run.intern.turn.lastEventAt,
      });
    }

    for (const project of visible) {
      for (const staffName of project.staff) {
        const run = staffWork.get(`${project.key}\u0000${staffName}`);
        people.push({
          id: `a-${hash(`${project.key}\u0000${staffName}`).slice(0, 12)}`,
          kind: "staff",
          role: staffName,
          roomKey: project.key,
          working: Boolean(run),
          task: run ? taskLabel(project.key, run.intern.turn.lastTool) : null,
          updatedAt: run ? run.intern.turn.lastEventAt : null,
        });
      }
    }

    for (const [key, fiscal] of fiscals) {
      if (!roomByKey.has(key) || now - fiscal.at > fiscalMs) continue;
      people.push({
        id: `f-${roomByKey.get(key).id.slice(2)}`,
        kind: "fiscal",
        role: "Fiscal",
        roomKey: key,
        working: true,
        task: `Veredito: ${fiscal.verdict}`,
        verdict: fiscal.verdict,
        updatedAt: fiscal.at,
      });
    }

    const litKeys = new Set(
      people.filter((p) => p.working && p.kind !== "fiscal" && p.roomKey).map((p) => p.roomKey),
    );
    const rooms = visible.map((project) => ({
      id: project.id,
      label: roomLabel(project),
      lit: litKeys.has(project.key),
    }));

    names.sync(people.filter((p) => p.kind !== "fiscal").map((p) => p.id));
    const agents = [
      {
        id: OWNER_ID,
        name: "Friol",
        kind: "owner",
        role: "Deus Onipotente",
        roomId: null,
        working: false,
        task: null,
        updatedAt: null,
      },
      ...people.map(({ roomKey, ...person }) => ({
        ...person,
        name: person.kind === "fiscal" ? "Fiscal Codex" : names.nameOf(person.id),
        roomId: roomKey ? roomByKey.get(roomKey).id : null,
      })),
    ];
    return { rooms, agents };
  }

  return { setProjects, ingestSession, ingestIntern, snapshot };
}

module.exports = { createState, OWNER_ID, TASK_LABELS, NAMES };
