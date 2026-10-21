import type { OfficeAgent } from "@/features/retro-office/core/types";
import { createDefaultAgentAvatarProfile } from "@/lib/avatars/profile";
import { sceneSafeText } from "@/features/tv/sceneText";

export type AgentarioAgentKind = "owner" | "session" | "staff" | "intern" | "fiscal";

export type AgentarioAgent = {
  id: string;
  name: string;
  kind: AgentarioAgentKind;
  role: string | null;
  status: "working" | "idle";
  task: string | null;
  room: string | null;
  roomId: string | null;
};

const KINDS: ReadonlySet<string> = new Set(["owner", "session", "staff", "intern", "fiscal"]);

// Cores fixas por tipo: o personagem é reconhecível de longe na TV.
const KIND_COLORS: Record<AgentarioAgentKind, string> = {
  owner: "#f5c542",
  session: "#5b8def",
  staff: "#9b6cf0",
  intern: "#4fc08d",
  fiscal: "#e8604c",
};

const KIND_ITEMS: Record<AgentarioAgentKind, string> = {
  owner: "coffee",
  session: "laptop",
  staff: "globe",
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
      role: optionalString(raw.role),
      status: raw.agentario.status === "working" ? "working" : "idle",
      task: optionalString(raw.agentario.task),
      room: optionalString(raw.agentario.room),
      roomId: optionalString(raw.agentario.roomId),
    });
  }
  return agents;
}

/** O Friol: o avatar padrão dele, com barba. */
const friolAvatar = () => {
  const base = createDefaultAgentAvatarProfile("friol");
  return { ...base, accessories: { ...base.accessories, beard: true } };
};

/** Converte para o formato da cena 3D. O subtítulo mostra a tarefa ou, parado, a sala. */
export function toOfficeAgents(agents: AgentarioAgent[]): OfficeAgent[] {
  return agents.map((agent) => ({
    id: agent.id,
    name: sceneSafeText(agent.name),
    subtitle: sceneSafeText(agent.status === "working" ? agent.task ?? agent.room : agent.room),
    status: agent.status,
    color: KIND_COLORS[agent.kind],
    item: KIND_ITEMS[agent.kind],
    avatarProfile: agent.kind === "owner" ? friolAvatar() : null,
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
      agent.role === other.role &&
      agent.status === other.status &&
      agent.task === other.task &&
      agent.room === other.room &&
      agent.roomId === other.roomId
    );
  });
}

/** O adaptador do Agentário se identifica no hello; qualquer outro gateway é recusado. */
export function isAgentarioHello(hello: unknown): boolean {
  return isRecord(hello) && isRecord(hello.agentario) && hello.agentario.version === 1;
}

export type AgentarioRoom = { id: string; label: string; lit: boolean };

/** Lê `agentario.rooms`: todas as salas de projeto (inclusive apagadas), em ordem estável. */
export function parseAgentarioRooms(payload: unknown): AgentarioRoom[] {
  if (!isRecord(payload) || !Array.isArray(payload.rooms)) return [];
  const rooms: AgentarioRoom[] = [];
  for (const raw of payload.rooms) {
    if (!isRecord(raw)) continue;
    const id = optionalString(raw.id);
    const label = optionalString(raw.label);
    if (id && label) rooms.push({ id, label, lit: raw.lit === true });
  }
  return rooms;
}

export function sameRooms(a: AgentarioRoom[], b: AgentarioRoom[]): boolean {
  return (
    a.length === b.length &&
    a.every((room, i) => room.id === b[i].id && room.label === b[i].label && room.lit === b[i].lit)
  );
}

export type AgentarioConfig = {
  night: { enabled: boolean; from: string; to: string };
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Lê `agentario.config` (só preferências de exibição). */
export function parseAgentarioConfig(payload: unknown): AgentarioConfig {
  const night = isRecord(payload) && isRecord(payload.night) ? payload.night : {};
  return {
    night: {
      enabled: night.enabled === true,
      from: typeof night.from === "string" && HHMM.test(night.from) ? night.from : "22:00",
      to: typeof night.to === "string" && HHMM.test(night.to) ? night.to : "07:00",
    },
  };
}
