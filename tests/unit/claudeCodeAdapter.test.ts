// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { normalizeConfig } = await import("../../server/claude-code/config");
const { createTailer } = await import("../../server/claude-code/tail");
const { createState, NAMES } = await import("../../server/claude-code/state");
const { createWatcher } = await import("../../server/claude-code/watcher");
const { locateCwd, listProjectFolders, readRegisteredAgents, projectRoots } = await import(
  "../../server/claude-code/rooms"
);
const { handleMethod, diffEvents, isLocalRequest, READ_METHODS } = await import(
  "../../server/claude-code/adapter"
);

// Tudo fictício: nenhum nome real de projeto ou conteúdo de transcript.
const NOW = Date.parse("2026-01-10T12:00:00.000Z");
const iso = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
const SECRET_TEXT = "texto-livre-que-nunca-pode-sair";
const ROOT = "/home/exemplo/.claude/projects";
const ROOTS = { real: ROOT, literal: ROOT, all: [ROOT] };
const CWD = `${ROOT}/projeto-exemplo`;
const OTHER = `${ROOT}/outro-projeto`;

type Person = { id: string; name: string; kind: string; role: string; roomId: string | null; working: boolean; task: string | null; verdict?: string };
type Snap = { rooms: Array<{ id: string; label: string; lit: boolean }>; agents: Person[] };

const userPrompt = (cwd: string, secondsAgo: number) => ({
  type: "user",
  cwd,
  timestamp: iso(secondsAgo),
  message: { role: "user", content: SECRET_TEXT },
});
const toolUse = (cwd: string, secondsAgo: number, id: string, name: string, input = {}) => ({
  type: "assistant",
  cwd,
  timestamp: iso(secondsAgo),
  message: { stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] },
});
const toolResult = (cwd: string, secondsAgo: number, id: string, content: string) => ({
  type: "user",
  cwd,
  timestamp: iso(secondsAgo),
  message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
});
const endTurn = (cwd: string, secondsAgo: number) => ({
  type: "assistant",
  cwd,
  timestamp: iso(secondsAgo),
  message: { stop_reason: "end_turn", content: [{ type: "text", text: SECRET_TEXT }] },
});

const config = (overrides = {}) => normalizeConfig({ claudeDir: "/nao-usado", ...overrides });
const newState = (overrides = {}, staff: Record<string, string[]> = {}) => {
  const state = createState(config(overrides), ROOTS);
  state.setProjects(
    ["outro-projeto", "projeto-exemplo", "projeto-interno"].map((key) => ({ key, staff: staff[key] ?? [] })),
  );
  return state;
};
const snap = (state: { snapshot: (now: number) => unknown }, now = NOW) => state.snapshot(now) as Snap;
const ofKind = (s: Snap, kind: string) => s.agents.filter((a) => a.kind === kind);

describe("rooms", () => {
  it("mapeia cwd para sala, centro ou fora", () => {
    expect(locateCwd(`${ROOT}/projeto-exemplo/sub/pasta`, ROOTS)).toEqual({ kind: "room", key: "projeto-exemplo" });
    expect(locateCwd(ROOT, ROOTS)).toEqual({ kind: "center", key: null });
    expect(locateCwd("/tmp/qualquer", ROOTS)).toEqual({ kind: "external", key: null });
    expect(locateCwd(`${ROOT}/-transcript-dir`, ROOTS)).toEqual({ kind: "external", key: null });
    expect(locateCwd(`${ROOT}-irmao/x`, ROOTS)).toEqual({ kind: "external", key: null });
    expect(locateCwd(null, ROOTS)).toEqual({ kind: "external", key: null });
  });
});

describe("state", () => {
  it("marca trabalhando com tool_use pendente e para no end_turn", () => {
    const state = newState();
    state.ingestSession("s1", userPrompt(CWD, 30));
    state.ingestSession("s1", toolUse(CWD, 20, "t1", "Edit"));
    let s = snap(state);
    expect(ofKind(s, "session")[0]).toMatchObject({ working: true, task: "Editando arquivo" });
    expect(s.rooms.find((r) => r.label === "projeto-exemplo")?.lit).toBe(true);

    state.ingestSession("s1", toolResult(CWD, 10, "t1", SECRET_TEXT));
    state.ingestSession("s1", endTurn(CWD, 5));
    s = snap(state);
    expect(ofKind(s, "session")[0]).toMatchObject({ working: false, task: null });
    expect(s.rooms.every((r) => !r.lit)).toBe(true);
  });

  it("subpasta vai para a sala do projeto; raiz vai para o centro; fora é ignorada", () => {
    const state = newState();
    state.ingestSession("s1", toolUse(`${CWD}/src/lib`, 10, "t1", "Bash"));
    state.ingestSession("s2", toolUse(ROOT, 10, "t2", "Bash"));
    state.ingestSession("s3", toolUse("/tmp/fora", 10, "t3", "Bash"));
    const sessions = ofKind(snap(state), "session");
    const room = snap(state).rooms.find((r) => r.label === "projeto-exemplo");
    expect(sessions).toHaveLength(2);
    expect(sessions.map((p) => p.roomId).sort()).toEqual([null, room?.id].sort());
  });

  it("lista todas as salas (inclusive apagadas) e cai para ocioso pelo fallback", () => {
    const state = newState({ idleFallbackSeconds: 60 });
    state.ingestSession("s1", toolUse(CWD, 120, "t1", "Bash"));
    const s = snap(state);
    expect(s.rooms.map((r) => r.label)).toEqual(["outro-projeto", "projeto-exemplo", "projeto-interno"]);
    expect(ofKind(s, "session")[0].working).toBe(false);

    state.ingestSession("s2", toolUse(CWD, 10, "t2", "Bash"));
    state.ingestSession("s2", { type: "system", subtype: "turn_duration", timestamp: iso(5) });
    expect(ofKind(snap(state), "session").every((a) => !a.working)).toBe(true);
  });

  it("aplica hidden, label e política de tarefas (inválida vira oculto)", () => {
    const state = newState({
      projects: {
        "projeto-exemplo": { hidden: true },
        "outro-projeto": { label: "Outro", tasks: "interno" },
        "projeto-interno": { tasks: "qualquer-coisa" },
      },
    });
    state.ingestSession("s1", toolUse(CWD, 10, "t1", "Edit"));
    state.ingestSession("s2", toolUse(OTHER, 10, "t2", "Edit"));
    state.ingestSession("s3", toolUse(`${ROOT}/projeto-interno`, 10, "t3", "Edit"));
    const s = snap(state);
    expect(s.rooms.map((r) => r.label)).toEqual(["Outro", "projeto-interno"]);
    const tasks = ofKind(s, "session").map((a) => a.task).sort();
    expect(tasks).toEqual(["Trabalhando", null].sort());
  });

  it("traz o Fiscal Codex só com veredito no resultado do codex exec", () => {
    const state = newState();
    state.ingestSession("s1", toolUse(CWD, 30, "c1", "Bash", { command: "cat p.md | codex exec -" }));
    state.ingestSession("s1", toolResult(CWD, 20, "c1", "**Veredito: revisar.** detalhes"));
    state.ingestSession("s1", toolUse(CWD, 15, "c2", "Bash", { command: "echo codex" }));
    state.ingestSession("s1", toolResult(CWD, 10, "c2", "Veredito: aprovar"));
    expect(ofKind(snap(state), "fiscal")).toEqual([
      expect.objectContaining({ name: "Fiscal Codex", verdict: "revisar" }),
    ]);
    expect(ofKind(snap(state, NOW + 11 * 60 * 1000), "fiscal")).toEqual([]);
  });

  it("estagiário aparece enquanto o pai espera e some depois", () => {
    const state = newState();
    state.ingestSession("s1", toolUse(CWD, 30, "a1", "Agent"));
    const info = { sessionId: "s1", toolUseId: "a1", agentType: "Explore<script>" };
    state.ingestIntern("s1/agent-x.jsonl", info, toolUse(CWD, 300, "x1", "Grep"));
    expect(ofKind(snap(state), "intern")).toEqual([
      expect.objectContaining({ role: "Explorescript", task: "Lendo código" }),
    ]);
    state.ingestSession("s1", toolResult(CWD, 5, "a1", "ok"));
    expect(ofKind(snap(state), "intern")).toEqual([]);
  });

  it("funcionário cadastrado trabalha pela execução mais antiga; extras viram reforço", () => {
    const state = newState({}, { "projeto-exemplo": ["revisor", "tester"] });
    let s = snap(state);
    expect(ofKind(s, "staff").map((a) => [a.role, a.working])).toEqual([
      ["revisor", false],
      ["tester", false],
    ]);
    expect(s.rooms.every((r) => !r.lit)).toBe(true);

    state.ingestSession("s1", toolUse(CWD, 40, "a1", "Agent"));
    state.ingestSession("s1", toolUse(CWD, 39, "a2", "Agent"));
    state.ingestIntern("s1/agent-1.jsonl", { sessionId: "s1", toolUseId: "a1", agentType: "Revisor" }, toolUse(CWD, 30, "x1", "Read"));
    state.ingestIntern("s1/agent-2.jsonl", { sessionId: "s1", toolUseId: "a2", agentType: "revisor" }, toolUse(CWD, 20, "x2", "Edit"));
    s = snap(state);
    expect(ofKind(s, "staff").find((a) => a.role === "revisor")).toMatchObject({ working: true, task: "Lendo código" });
    expect(ofKind(s, "intern")).toEqual([expect.objectContaining({ role: "revisor (reforço)" })]);
    expect(s.rooms.find((r) => r.label === "projeto-exemplo")?.lit).toBe(true);
  });

  it("dá nomes russos únicos e estáveis", () => {
    const state = newState();
    for (let i = 0; i < 40; i += 1) state.ingestSession(`s${i}`, toolUse(CWD, 10, `t${i}`, "Bash"));
    const first = ofKind(snap(state), "session");
    const names = first.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => NAMES.includes(name))).toBe(true);
    const again = ofKind(snap(state), "session");
    expect(again.map((a) => a.name)).toEqual(names);
    expect(snap(state).agents.find((a) => a.kind === "owner")).toMatchObject({ name: "Friol", role: "Deus Onipotente" });
  });

  it("nunca expõe texto do transcript nem caminhos no snapshot", () => {
    const state = newState();
    state.ingestSession("sess-real-id", userPrompt(CWD, 10));
    state.ingestSession("sess-real-id", toolUse(CWD, 5, "t1", "FerramentaDesconhecida"));
    const json = JSON.stringify(state.snapshot(NOW));
    expect(json).not.toContain(SECRET_TEXT);
    expect(json).not.toContain("/home/exemplo");
    expect(json).not.toContain("sess-real-id");
    expect(json).toContain("projeto-exemplo");
  });
});

describe("tail", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentario-tail-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("guarda linha incompleta, descarta fragmento inicial e reinicia no truncamento", () => {
    const file = path.join(dir, "s.jsonl");
    fs.writeFileSync(file, `${"x".repeat(50)}\n{"n":1}\n{"n":`);
    const tailer = createTailer(file, { initialTailBytes: 20 });
    expect(tailer.read()).toEqual([{ n: 1 }]);
    fs.appendFileSync(file, `2}\nlixo\n`);
    expect(tailer.read()).toEqual([{ n: 2 }]);

    fs.writeFileSync(file, `{"n":3}\n`);
    expect(tailer.read()).toEqual([{ n: 3 }]);
  });
});

describe("disco (rooms + watcher)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agentario-claude-")));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const line = (o: object) => `${JSON.stringify(o)}\n`;

  it("lista pastas de projeto, aplica exclude e lê só o name dos cadastrados", () => {
    const projects = path.join(root, "projects");
    fs.mkdirSync(path.join(projects, "alfa", ".claude", "agents"), { recursive: true });
    fs.mkdirSync(path.join(projects, "beta-backup"), { recursive: true });
    fs.mkdirSync(path.join(projects, "-transcripts"), { recursive: true });
    fs.mkdirSync(path.join(projects, ".oculta"), { recursive: true });
    fs.mkdirSync(path.join(root, "fora", "agents"), { recursive: true });
    fs.symlinkSync(path.join(root, "fora"), path.join(projects, "link-fora"));
    fs.writeFileSync(path.join(projects, "alfa", ".claude", "agents", "a.md"), `---\nname: revisor\ndescription: ${SECRET_TEXT}\n---\ncorpo`);
    fs.writeFileSync(path.join(projects, "alfa", ".claude", "agents", "b.md"), `---\nname: Revisor\n---\n`);
    fs.writeFileSync(path.join(projects, "alfa", ".claude", "agents", "grande.md"), `---\nname: grande\n---\n${"x".repeat(9000)}`);
    fs.writeFileSync(path.join(root, "fora", "agents", "x.md"), "---\nname: intruso\n---\n");

    const roots = projectRoots(root);
    expect(listProjectFolders(roots, ["backup"])).toEqual(["alfa"]);
    expect(readRegisteredAgents(roots, "alfa")).toEqual(["revisor"]);
    expect(readRegisteredAgents(roots, "link-fora")).toEqual([]);
  });

  it("watcher lê só pastas de transcript, ignora symlinks e monta salas e pessoas", () => {
    const now = Date.now();
    const stamp = (s: number) => new Date(now - s * 1000).toISOString();
    const projects = path.join(root, "projects");
    const cwd = path.join(projects, "projeto-exemplo", "sub");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(path.join(projects, "projeto-vazio"), { recursive: true });
    const slug = path.join(projects, "-transcript-exemplo");
    fs.mkdirSync(path.join(slug, "s1", "subagents"), { recursive: true });
    fs.writeFileSync(
      path.join(slug, "s1.jsonl"),
      line({ type: "assistant", cwd, timestamp: stamp(5), message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a1", name: "Agent", input: {} }] } }),
    );
    fs.writeFileSync(
      path.join(slug, "s1", "subagents", "agent-abc.jsonl"),
      line({ type: "assistant", cwd, timestamp: stamp(3), message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] } }),
    );
    fs.writeFileSync(path.join(slug, "s1", "subagents", "agent-abc.meta.json"), JSON.stringify({ agentType: "Explore", toolUseId: "a1" }));
    const outside = path.join(root, "fora.jsonl");
    fs.writeFileSync(outside, line({ type: "assistant", cwd, timestamp: stamp(1), message: { content: [] } }));
    fs.symlinkSync(outside, path.join(slug, "link.jsonl"));

    const cfg = normalizeConfig({ claudeDir: root });
    const roots = projectRoots(root);
    const state = createState(cfg, roots);
    const watcher = createWatcher({ config: cfg, state, roots });
    watcher.discover(now);
    watcher.poll();
    const s = state.snapshot(now) as Snap;
    expect(s.rooms.map((r) => [r.label, r.lit])).toEqual([
      ["projeto-exemplo", true],
      ["projeto-vazio", false],
    ]);
    expect(s.agents.map((a) => a.kind).sort()).toEqual(["intern", "owner", "session"]);
    expect(watcher.trackedFiles).toBe(2);
  });
});

type Frame = {
  ok?: boolean;
  event?: string;
  error?: { code: string };
  payload: {
    state?: string;
    runId?: string;
    stopReason?: string;
    defaultId?: string;
    mainKey?: string;
    agents?: Array<Record<string, unknown>>;
    rooms?: Array<Record<string, unknown>>;
    previews?: Array<{ status: string }>;
  };
};
const call = (method: string, params: object, getSnapshot: () => unknown) =>
  handleMethod(method, params, "1", getSnapshot) as unknown as Frame;
const diff = (a: unknown, b: unknown, runIds: Map<string, string>) =>
  diffEvents(a, b, runIds) as unknown as Frame[];

describe("adapter", () => {
  const snapshot = {
    rooms: [{ id: "p-1", label: "Sala A", lit: true }],
    agents: [
      { id: "friol", name: "Friol", kind: "owner", role: "Deus Onipotente", roomId: null, working: false, task: null, updatedAt: null },
      { id: "s-1", name: "Andrei", kind: "session", role: "Claude", roomId: "p-1", working: true, task: "Rodando comando", updatedAt: NOW },
    ],
  };

  it("recusa qualquer método fora da allowlist", () => {
    for (const method of ["chat.send", "agents.create", "config.set", "agents.files.set", "cron.add", "inventado"]) {
      expect(call(method, {}, () => snapshot)).toMatchObject({ ok: false, error: { code: "read_only" } });
    }
    for (const method of READ_METHODS) {
      expect(call(method, {}, () => snapshot).ok).toBe(true);
    }
  });

  it("responde agents.list, agentario.rooms e sessions.preview", () => {
    const list = call("agents.list", {}, () => snapshot);
    expect(list.payload).toMatchObject({ defaultId: "friol", mainKey: "main" });
    expect(list.payload.agents?.[1]).toMatchObject({
      id: "s-1",
      name: "Andrei",
      workspace: "sala:Sala A",
      agentario: { kind: "session", status: "working", task: "Rodando comando", room: "Sala A", roomId: "p-1" },
    });
    expect(list.payload.agents?.[0]).toMatchObject({
      agentario: { kind: "owner", status: "idle", task: null, room: null, roomId: null },
    });
    expect(call("agentario.rooms", {}, () => snapshot).payload.rooms).toEqual(snapshot.rooms);
    const preview = call("sessions.preview", { keys: ["agent:s-1:main", "agent:friol:main"] }, () => snapshot);
    expect(preview.payload.previews?.map((p) => p.status)).toEqual(["ok", "empty"]);
  });

  it("gera delta ao começar, final ao parar e presence quando a sala apaga", () => {
    const runIds = new Map<string, string>();
    const idle = { rooms: [{ ...snapshot.rooms[0], lit: false }], agents: [snapshot.agents[0]] };
    const started = diff(idle, snapshot, runIds);
    expect(started.map((e) => e.payload.state ?? e.event)).toEqual(["delta", "presence"]);
    const stopped = {
      rooms: [{ ...snapshot.rooms[0], lit: false }],
      agents: [snapshot.agents[0], { ...snapshot.agents[1], working: false, task: null }],
    };
    const ended = diff(snapshot, stopped, runIds);
    expect(ended[0].payload).toMatchObject({ state: "final", stopReason: "end_turn", runId: started[0].payload.runId });
    expect(ended.at(-1)?.event).toBe("presence");
    expect(diff(stopped, stopped, runIds)).toEqual([]);
  });

  it("aceita só Host/Origin locais", () => {
    expect(isLocalRequest({ host: "localhost:18790", origin: "http://localhost:18790" })).toBe(true);
    expect(isLocalRequest({ host: "127.0.0.1:18790" })).toBe(true);
    expect(isLocalRequest({ host: "localhost:18790", origin: "https://evil.example" })).toBe(false);
    expect(isLocalRequest({ host: "evil.example:18790" })).toBe(false);
  });
});
