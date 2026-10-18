// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { normalizeConfig } = await import("../../server/claude-code/config");
const { createTailer } = await import("../../server/claude-code/tail");
const { createState } = await import("../../server/claude-code/state");
const { createWatcher } = await import("../../server/claude-code/watcher");
const { handleMethod, diffEvents, isLocalRequest, READ_METHODS } = await import(
  "../../server/claude-code/adapter"
);

// Tudo fictício: nenhum nome real de projeto ou conteúdo de transcript.
const NOW = Date.parse("2026-01-10T12:00:00.000Z");
const iso = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();
const SECRET_TEXT = "texto-livre-que-nunca-pode-sair";

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

describe("state", () => {
  const CWD = "/home/exemplo/projeto-exemplo";

  it("marca trabalhando com tool_use pendente e para no end_turn", () => {
    const state = createState(config());
    state.ingestSession("s1", userPrompt(CWD, 30));
    state.ingestSession("s1", toolUse(CWD, 20, "t1", "Edit"));
    let agent = state.snapshot(NOW).agents.find((a) => a.kind === "session");
    expect(agent).toMatchObject({ working: true, task: "Editando arquivo" });

    state.ingestSession("s1", toolResult(CWD, 10, "t1", SECRET_TEXT));
    state.ingestSession("s1", endTurn(CWD, 5));
    agent = state.snapshot(NOW).agents.find((a) => a.kind === "session");
    expect(agent).toMatchObject({ working: false, task: null });
  });

  it("para no system/turn_duration e cai para ocioso pelo fallback de tempo", () => {
    const state = createState(config({ idleFallbackSeconds: 60 }));
    state.ingestSession("s1", toolUse(CWD, 120, "t1", "Bash"));
    expect(state.snapshot(NOW).agents.find((a) => a.kind === "session")?.working).toBe(false);

    state.ingestSession("s2", toolUse(CWD, 10, "t2", "Bash"));
    state.ingestSession("s2", { type: "system", subtype: "turn_duration", timestamp: iso(5) });
    const s2 = state.snapshot(NOW).agents.filter((a) => a.kind === "session");
    expect(s2.every((a) => !a.working)).toBe(true);
  });

  it("oculta projeto e tarefas conforme config local", () => {
    const state = createState(
      config({
        projects: {
          "projeto-exemplo": { hidden: true },
          "outro-projeto": { label: "Outro", hideTasks: true },
        },
      })
    );
    state.ingestSession("s1", toolUse(CWD, 10, "t1", "Edit"));
    state.ingestSession("s2", toolUse("/home/exemplo/outro-projeto", 10, "t2", "Edit"));
    const snap = state.snapshot(NOW);
    expect(snap.rooms).toEqual([expect.objectContaining({ label: "Outro" })]);
    expect(snap.agents.filter((a) => a.kind === "session")).toEqual([
      expect.objectContaining({ task: "Trabalhando" }),
    ]);
  });

  it("traz o Fiscal Codex só com veredito no resultado do codex exec", () => {
    const state = createState(config());
    state.ingestSession("s1", toolUse(CWD, 30, "c1", "Bash", { command: "cat p.md | codex exec -" }));
    state.ingestSession("s1", toolResult(CWD, 20, "c1", "**Veredito: revisar.** detalhes"));
    state.ingestSession("s1", toolUse(CWD, 15, "c2", "Bash", { command: "echo codex" }));
    state.ingestSession("s1", toolResult(CWD, 10, "c2", "Veredito: aprovar"));
    const fiscals = state.snapshot(NOW).agents.filter((a) => a.kind === "fiscal");
    expect(fiscals).toEqual([expect.objectContaining({ name: "Fiscal Codex", verdict: "revisar" })]);
    expect(state.snapshot(NOW + 11 * 60 * 1000).agents.some((a) => a.kind === "fiscal")).toBe(false);
  });

  it("mostra estagiário enquanto o pai espera o Agent e some depois", () => {
    const state = createState(config());
    state.ingestSession("s1", toolUse(CWD, 30, "a1", "Agent"));
    const info = { sessionId: "s1", toolUseId: "a1", agentType: "Explore<script>" };
    state.ingestIntern("s1/agent-x.jsonl", info, toolUse(CWD, 300, "x1", "Grep"));
    let interns = state.snapshot(NOW).agents.filter((a) => a.kind === "intern");
    expect(interns).toEqual([expect.objectContaining({ role: "Explorescript", task: "Lendo código" })]);
    expect(interns[0].name).toMatch(/^Estagiário /);

    state.ingestSession("s1", toolResult(CWD, 5, "a1", "ok"));
    interns = state.snapshot(NOW).agents.filter((a) => a.kind === "intern");
    expect(interns).toEqual([]);
  });

  it("nunca expõe texto do transcript nem caminhos no snapshot", () => {
    const state = createState(config());
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

describe("watcher", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "agentario-claude-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("lê só pastas de transcript, ignora symlinks e pastas de código", () => {
    const now = Date.now();
    const stamp = (s: number) => new Date(now - s * 1000).toISOString();
    const projects = path.join(root, "projects");
    const slug = path.join(projects, "-home-exemplo-projeto-exemplo");
    fs.mkdirSync(path.join(slug, "s1", "subagents"), { recursive: true });
    fs.mkdirSync(path.join(projects, "codigo-local"), { recursive: true });
    const line = (o: object) => `${JSON.stringify(o)}\n`;
    const cwd = "/home/exemplo/projeto-exemplo";
    fs.writeFileSync(
      path.join(slug, "s1.jsonl"),
      line({ type: "assistant", cwd, timestamp: stamp(5), message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a1", name: "Agent", input: {} }] } })
    );
    fs.writeFileSync(
      path.join(slug, "s1", "subagents", "agent-abc.jsonl"),
      line({ type: "assistant", cwd, timestamp: stamp(3), message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "x", name: "Read", input: {} }] } })
    );
    fs.writeFileSync(
      path.join(slug, "s1", "subagents", "agent-abc.meta.json"),
      JSON.stringify({ agentType: "Explore", toolUseId: "a1" })
    );
    fs.writeFileSync(
      path.join(projects, "codigo-local", "fixture.jsonl"),
      line({ type: "assistant", cwd: "/nao/deve/aparecer", timestamp: stamp(1), message: { content: [] } })
    );
    const outside = path.join(root, "fora.jsonl");
    fs.writeFileSync(outside, line({ type: "assistant", cwd: "/link/fora", timestamp: stamp(1), message: { content: [] } }));
    fs.symlinkSync(outside, path.join(slug, "link.jsonl"));

    const cfg = normalizeConfig({ claudeDir: root });
    const state = createState(cfg);
    const watcher = createWatcher({ config: cfg, state });
    watcher.discover(now);
    watcher.poll();
    const snap = state.snapshot(now);
    expect(snap.rooms.map((r) => r.label)).toEqual(["projeto-exemplo"]);
    expect(snap.agents.map((a) => a.kind).sort()).toEqual(["intern", "owner", "session"]);
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
    previews?: Array<{ status: string }>;
  };
};
const call = (method: string, params: object, getSnapshot: () => unknown) =>
  handleMethod(method, params, "1", getSnapshot) as unknown as Frame;
const diff = (a: unknown, b: unknown, runIds: Map<string, string>) =>
  diffEvents(a, b, runIds) as unknown as Frame[];

describe("adapter", () => {
  const snapshot = {
    rooms: [{ id: "p-1", label: "Sala A" }],
    agents: [
      { id: "friol", name: "Friol", kind: "owner", role: "Dono", projectId: null, working: false, task: null, updatedAt: null },
      { id: "s-1", name: "Ana", kind: "session", role: "Claude", projectId: "p-1", working: true, task: "Rodando comando", updatedAt: NOW },
    ],
  };

  it("recusa qualquer método fora da allowlist", () => {
    for (const method of ["chat.send", "agents.create", "config.set", "agents.files.set", "cron.add", "inventado"]) {
      expect(call(method, {}, () => snapshot)).toMatchObject({
        ok: false,
        error: { code: "read_only" },
      });
    }
    for (const method of READ_METHODS) {
      expect(call(method, {}, () => snapshot).ok).toBe(true);
    }
  });

  it("responde agents.list e sessions.preview no formato do gateway", () => {
    const list = call("agents.list", {}, () => snapshot);
    expect(list.payload).toMatchObject({ defaultId: "friol", mainKey: "main" });
    expect(list.payload.agents?.[1]).toMatchObject({ id: "s-1", name: "Ana", workspace: "sala:Sala A" });
    const preview = call("sessions.preview", { keys: ["agent:s-1:main", "agent:friol:main"] }, () => snapshot);
    expect(preview.payload.previews?.map((p) => p.status)).toEqual(["ok", "empty"]);
  });

  it("gera delta ao começar, final ao parar e presence", () => {
    const runIds = new Map<string, string>();
    const idle = { ...snapshot, agents: [snapshot.agents[0]] };
    const started = diff(idle, snapshot, runIds);
    expect(started.map((e) => e.payload.state ?? e.event)).toEqual(["delta", "presence"]);
    const stopped = { ...snapshot, agents: [snapshot.agents[0], { ...snapshot.agents[1], working: false, task: null }] };
    const ended = diff(snapshot, stopped, runIds);
    expect(ended[0].payload).toMatchObject({ state: "final", stopReason: "end_turn", runId: started[0].payload.runId });
    expect(diff(stopped, stopped, runIds)).toEqual([]);
  });

  it("aceita só Host/Origin locais", () => {
    expect(isLocalRequest({ host: "localhost:18790", origin: "http://localhost:18790" })).toBe(true);
    expect(isLocalRequest({ host: "127.0.0.1:18790" })).toBe(true);
    expect(isLocalRequest({ host: "localhost:18790", origin: "https://evil.example" })).toBe(false);
    expect(isLocalRequest({ host: "evil.example:18790" })).toBe(false);
  });
});
