import type { AgentarioAgent, AgentarioRoom } from "@/features/tv/agentarioAgents";

/** Mostra só a primeira metade do nome e troca o resto por pontos (para tirar print). */
export function maskName(name: string): string {
  const chars = [...name];
  const keep = Math.ceil(chars.length / 2);
  return chars.slice(0, keep).join("") + "•".repeat(chars.length - keep);
}

/** Aplica a máscara nos nomes das salas e na sala de cada personagem. */
export function maskRoomNames(view: { rooms: AgentarioRoom[]; agents: AgentarioAgent[] }) {
  return {
    rooms: view.rooms.map((room) => ({ ...room, label: maskName(room.label) })),
    agents: view.agents.map((agent) => (agent.room ? { ...agent, room: maskName(agent.room) } : agent)),
  };
}
