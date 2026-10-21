import { describe, expect, it } from "vitest";
import {
  isAgentarioHello,
  parseAgentarioAgents,
  sameAgents,
  toOfficeAgents,
} from "@/features/tv/agentarioAgents";

const payload = {
  defaultId: "friol",
  agents: [
    { id: "friol", name: "Friol", agentario: { kind: "owner", status: "idle", task: null, room: null } },
    { id: "s-1", name: "Ana", agentario: { kind: "session", status: "working", task: "Rodando comando", room: "Sala A" } },
    { id: "s-2", name: "Bento", agentario: { kind: "session", status: "idle", task: null, room: "Sala B" } },
    { id: "x-1", name: "Sem bloco" },
    { id: "x-2", name: "Tipo inválido", agentario: { kind: "hacker", status: "working" } },
  ],
};

describe("agentarioAgents", () => {
  it("lê só agentes com bloco agentario válido", () => {
    const agents = parseAgentarioAgents(payload);
    expect(agents.map((agent) => agent.id)).toEqual(["friol", "s-1", "s-2"]);
    expect(agents[1]).toEqual({
      id: "s-1",
      name: "Ana",
      kind: "session",
      role: null,
      status: "working",
      task: "Rodando comando",
      room: "Sala A",
      roomId: null,
    });
    expect(parseAgentarioAgents(null)).toEqual([]);
    expect(parseAgentarioAgents({ agents: "x" })).toEqual([]);
  });

  it("mapeia para a cena: tarefa quando trabalhando, sala quando parado", () => {
    const office = toOfficeAgents(parseAgentarioAgents(payload));
    expect(office[1]).toMatchObject({ status: "working", subtitle: "Rodando comando", item: "laptop" });
    expect(office[2]).toMatchObject({ status: "idle", subtitle: "Sala B" });
    expect(office[0]).toMatchObject({ name: "Friol", subtitle: null, item: "coffee" });
  });

  it("o Friol tem barba; os demais usam o avatar padrão", () => {
    const office = toOfficeAgents(parseAgentarioAgents(payload));
    expect(office[0].avatarProfile?.accessories.beard).toBe(true);
    expect(office[1].avatarProfile).toBeNull();
  });

  it("detecta igualdade estrutural", () => {
    const a = parseAgentarioAgents(payload);
    const b = parseAgentarioAgents(JSON.parse(JSON.stringify(payload)));
    expect(sameAgents(a, b)).toBe(true);
    b[1] = { ...b[1], task: "Editando arquivo" };
    expect(sameAgents(a, b)).toBe(false);
    expect(sameAgents(a, a.slice(1))).toBe(false);
  });

  it("aceita só o hello do adaptador do Agentário", () => {
    expect(isAgentarioHello({ type: "hello-ok", agentario: { version: 1 } })).toBe(true);
    expect(isAgentarioHello({ type: "hello-ok", adapterType: "demo" })).toBe(false);
    expect(isAgentarioHello(null)).toBe(false);
  });
});
