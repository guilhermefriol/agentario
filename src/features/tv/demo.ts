import type { AgentarioAgent, AgentarioRoom } from "@/features/tv/agentarioAgents";
import { unitHash } from "@/features/tv/movement";

export const DEMO_WINDOW_MS = 60 * 1000;

const DEMO_NAMES = [
  "Andrei", "Serguei", "Maksim", "Iuri", "Dmitri", "Ivan", "Aleksei", "Nikolai", "Mikhail", "Vladimir",
  "Boris", "Oleg", "Pavel", "Igor", "Fiodor", "Konstantin", "Viktor", "Anatoli", "Grigori", "Leonid",
  "Stanislav", "Timofei", "Vassili", "Ievgueni", "Artiom", "Ruslan", "Kirill", "Arkadi", "Gennadi", "Valentin",
  "Anastassia", "Natacha", "Olga", "Svetlana", "Tatiana", "Irina", "Iekaterina", "Liudmila", "Dária", "Ksenia",
  "Ielena", "Marina", "Galina", "Vera", "Nadejda", "Sofia", "Polina", "Alina", "Ievguenia", "Valentina",
  "Roman", "Iaroslav", "Bogdan", "Matvei", "Lev", "Egor", "Semion", "Vadim", "Gleb", "Danil",
];
const DEMO_TASKS = ["Editando arquivo", "Rodando comando", "Lendo código", "Pesquisando", "Delegando"];
const DEMO_INTERN_ROLES = ["Explore", "Plan", "general-purpose"];
const DEMO_VERDICTS = ["aprovar", "revisar", "bloquear"];

/**
 * Modo demonstração: todas as salas acesas, um Claude trabalhando em cada uma, estagiários
 * nas salas sem funcionários e 1–2 auditorias do Fiscal. Os personagens reais continuam
 * com os mesmos ids e nomes. Quantos fictícios cada sala ganha depende só do id da sala.
 */
export function applyDemo(
  rooms: AgentarioRoom[],
  agents: AgentarioAgent[],
  now: number,
): { rooms: AgentarioRoom[]; agents: AgentarioAgent[] } {
  const window = Math.floor(now / DEMO_WINDOW_MS);
  const usedNames = new Set(agents.map((agent) => agent.name));
  let nameCursor = 0;
  const nextName = () => {
    while (nameCursor < DEMO_NAMES.length * 4) {
      const base = DEMO_NAMES[nameCursor % DEMO_NAMES.length];
      const round = Math.floor(nameCursor / DEMO_NAMES.length);
      nameCursor += 1;
      const name = round === 0 ? base : `${base} ${round + 1}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    return `Visitante ${nameCursor}`;
  };

  const staffedRooms = new Set(agents.filter((a) => a.kind === "staff").map((a) => a.roomId));
  const extra: AgentarioAgent[] = [];
  const auditRooms = [...rooms]
    .sort((a, b) => unitHash(`${a.id}:audit:${window}`) - unitHash(`${b.id}:audit:${window}`))
    .slice(0, rooms.length > 1 ? 2 : rooms.length);

  for (const room of rooms) {
    extra.push({
      id: `demo:${room.id}:c`,
      name: nextName(),
      kind: "session",
      role: "Claude",
      status: "working",
      task: DEMO_TASKS[Math.floor(unitHash(`${room.id}:task:${window}`) * DEMO_TASKS.length)],
      room: room.label,
      roomId: room.id,
    });
    if (!staffedRooms.has(room.id)) {
      const interns = Math.floor(unitHash(`${room.id}:interns`) * 3);
      for (let i = 0; i < interns; i += 1) {
        extra.push({
          id: `demo:${room.id}:i${i}`,
          name: nextName(),
          kind: "intern",
          role: DEMO_INTERN_ROLES[i % DEMO_INTERN_ROLES.length],
          status: "working",
          task: DEMO_TASKS[(i + 2) % DEMO_TASKS.length],
          room: room.label,
          roomId: room.id,
        });
      }
    }
  }
  for (const room of auditRooms) {
    const verdict = DEMO_VERDICTS[Math.floor(unitHash(`${room.id}:verdict:${window}`) * 3)];
    extra.push({
      id: `demo:${room.id}:fiscal`,
      name: "Fiscal Codex",
      kind: "fiscal",
      role: "Fiscal",
      status: "working",
      task: `Veredito: ${verdict}`,
      room: room.label,
      roomId: room.id,
    });
  }
  return {
    rooms: rooms.map((room) => ({ ...room, lit: true })),
    agents: [...agents, ...extra],
  };
}
