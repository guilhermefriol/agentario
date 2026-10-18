import type { OfficeAgent } from "@/features/retro-office/core/types";

export type AgentarioAgentKind = "owner" | "session" | "intern" | "fiscal";

export type AgentarioAgent = {
  id: string;
  name: string;
  kind: AgentarioAgentKind;
  status: "working" | "idle";
  task: string | null;
  room: string | null;
};

const KINDS: ReadonlySet<string> = new Set(["owner", "session", "intern", "fiscal"]);

// Cores fixas por tipo: o personagem é reconhecível de longe na TV.
const KIND_COLORS: Record<AgentarioAgentKind, string> = {
  owner: "#f5c542",
  session: "#5b8def",
  intern: "#4fc08d",
  fiscal: "#e8604c",
};

const KIND_ITEMS: Record<AgentarioAgentKind, string> = {
  owner: "coffee",
  session: "laptop",
  intern: "books",
  fiscal: "shield",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/** Lê o payload de `agents.list` do adaptador. Agentes sem o bloco `agentario` são ignorados. */
export function parseAgentarioAgents(payload: unknown): AgentarioAgent[] {
  if (!isRecord(payload) || !Array.isArray(payload.agents)) return [];
  const agents: AgentarioAgent[] = [];
  for (const raw of payload.agents) {
    if (!isRecord(raw) || !isRecord(raw.agentario)) continue;
    const id = optionalString(raw.id);
    const name = optionalString(raw.name);
    const kind = raw.agentario.kind;
    if (!id || !name || typeof kind !== "string" || !KINDS.has(kind)) continue;
    agents.push({
      id,
      name,
      kind: kind as AgentarioAgentKind,
      status: raw.agentario.status === "working" ? "working" : "idle",
      task: optionalString(raw.agentario.task),
      room: optionalString(raw.agentario.room),
    });
  }
  return agents;
}

/** Converte para o formato da cena 3D. O subtítulo mostra a tarefa ou, parado, a sala. */
export function toOfficeAgents(agents: AgentarioAgent[]): OfficeAgent[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    subtitle: agent.status === "working" ? agent.task ?? agent.room : agent.room,
    status: agent.status,
    color: KIND_COLORS[agent.kind],
    item: KIND_ITEMS[agent.kind],
    avatarProfile: null,
  }));
}

/** Igualdade estrutural: evita trocar o array (e re-renderizar a cena) quando nada mudou. */
export function sameAgents(a: AgentarioAgent[], b: AgentarioAgent[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((agent, index) => {
    const other = b[index];
    return (
      agent.id === other.id &&
      agent.name === other.name &&
      agent.kind === other.kind &&
      agent.status === other.status &&
      agent.task === other.task &&
      agent.room === other.room
    );
  });
}

/** O adaptador do Agentário se identifica no hello; qualquer outro gateway é recusado. */
export function isAgentarioHello(hello: unknown): boolean {
  return isRecord(hello) && isRecord(hello.agentario) && hello.agentario.version === 1;
}
