import type { AgentDirectedTarget } from "@/features/retro-office/core/types";
import type { AgentarioAgent } from "@/features/tv/agentarioAgents";
import { LEISURE_ROOMS } from "@/features/tv/layout/rooms";
import type { Layout, LayoutDemand, LayoutRoom, Spot } from "@/features/tv/layout/types";

export const LEISURE_WINDOW_MS = 4 * 60 * 1000;
export const DEMO_LEISURE_WINDOW_MS = 60 * 1000;
export const VISIT_WINDOW_MS = 30 * 1000;
export const LEISURE_RATIO = 0.5;
export const DEMO_LEISURE_RATIO = 0.6;
const MAX_VISITS = 4;
const VISIT_CHANCE = 0.2;

/** Hash estável em [0, 1). */
export function unitHash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Dimensionamento do layout: mesas por sala estáveis (funcionários cadastrados + 1 para a sessão
 * do Claude), quantas pessoas estão em cada sala agora e quantas existem no total.
 */
export function layoutDemand(agents: AgentarioAgent[]): LayoutDemand {
  const seatsByRoom: Record<string, number> = {};
  const colsByRoom: Record<string, number> = {};
  for (const agent of agents) {
    if (!agent.roomId || agent.kind === "fiscal" || agent.kind === "owner") continue;
    seatsByRoom[agent.roomId] = (seatsByRoom[agent.roomId] ?? 0) + 1;
    if (agent.kind === "staff") colsByRoom[agent.roomId] = (colsByRoom[agent.roomId] ?? 1) + 1;
  }
  return { seatsByRoom, colsByRoom, population: agents.length };
}

export type MovementInput = {
  layout: Layout;
  rooms: LayoutRoom[];
  agents: AgentarioAgent[];
  now: number;
  demo?: boolean;
  /** Ids presentes na primeira carga: só quem chega depois entra caminhando pela porta do centro. */
  initialIds?: ReadonlySet<string>;
};

const toTarget = (spot: Spot, spawnFrom?: { x: number; y: number }): AgentDirectedTarget => ({
  x: spot.x,
  y: spot.y,
  facing: spot.facing,
  pose: spot.pose,
  workoutStyle: spot.workoutStyle,
  spawnFrom,
});

/**
 * Decide o alvo de cada personagem:
 * trabalhando → mesa da sala; parado em sala apagada → lazer (todos);
 * parado em sala acesa → até 50% no lazer (troca a cada 4 min); algumas visitas curtas ao Friol;
 * quem não couber no lazer vai para a área de espera.
 */
export function assignTargets(input: MovementInput): Record<string, AgentDirectedTarget> {
  const { layout, rooms, agents, now, demo = false, initialIds } = input;
  const windowMs = demo ? DEMO_LEISURE_WINDOW_MS : LEISURE_WINDOW_MS;
  const ratio = demo ? DEMO_LEISURE_RATIO : LEISURE_RATIO;
  const leisureWindow = Math.floor(now / windowMs);
  const visitWindow = Math.floor(now / VISIT_WINDOW_MS);
  const litById = new Map(rooms.map((room) => [room.id, room.lit]));
  const targets: Record<string, AgentDirectedTarget> = {};
  const centerDoor = layout.center.door;
  // Quem chega depois da primeira carga entra pela porta do centro; personagens da demonstração já surgem no lugar.
  const arriving = (id: string) =>
    initialIds && !initialIds.has(id) && !id.startsWith("demo:") ? centerDoor : undefined;

  const mustLeave: AgentarioAgent[] = [];
  const mayLeave: AgentarioAgent[] = [];
  const stayByRoom = new Map<string, AgentarioAgent[]>();
  const centerStay: AgentarioAgent[] = [];

  for (const agent of agents) {
    if (agent.kind === "owner") {
      targets[agent.id] = toTarget(layout.center.friol);
      continue;
    }
    if (agent.kind === "fiscal") {
      const spot = (agent.roomId && layout.fiscalByRoom[agent.roomId]) || layout.center.fiscal;
      targets[agent.id] = toTarget(spot, centerDoor);
      continue;
    }
    const roomShown = agent.roomId ? Boolean(layout.seatsByRoom[agent.roomId]) : false;
    if (agent.status === "working") {
      if (agent.roomId && roomShown) {
        stayByRoom.set(agent.roomId, [...(stayByRoom.get(agent.roomId) ?? []), agent]);
      } else {
        centerStay.push(agent);
      }
      continue;
    }
    const lit = agent.roomId ? litById.get(agent.roomId) === true : true;
    if (!lit || (agent.roomId && !roomShown)) mustLeave.push(agent);
    else mayLeave.push(agent);
  }

  // Até 50% dos parados de salas acesas (e do centro) saem; a escolha muda a cada janela.
  const byWindowHash = (a: AgentarioAgent, b: AgentarioAgent) =>
    unitHash(`${a.id}:${leisureWindow}`) - unitHash(`${b.id}:${leisureWindow}`);
  const sortedMay = [...mayLeave].sort(byWindowHash);
  const leaveCount = Math.floor(sortedMay.length * ratio);
  const leavers = [...mustLeave, ...sortedMay.slice(0, leaveCount)].sort(byWindowHash);
  for (const agent of sortedMay.slice(leaveCount)) {
    if (agent.roomId) stayByRoom.set(agent.roomId, [...(stayByRoom.get(agent.roomId) ?? []), agent]);
    else centerStay.push(agent);
  }

  // Quem fica: mesas da própria sala, em ordem estável (quem trabalha primeiro). Quem passar da
  // lotação da sala vai para a Área de espera (os corredores ficam livres).
  const overflow: AgentarioAgent[] = [];
  for (const [roomId, people] of stayByRoom) {
    const seats = layout.seatsByRoom[roomId] ?? [];
    const ordered = [...people].sort(
      (a, b) =>
        Number(b.status === "working") - Number(a.status === "working") || a.id.localeCompare(b.id),
    );
    ordered.forEach((agent, index) => {
      const seat = seats[index];
      if (!seat) {
        overflow.push(agent);
        return;
      }
      const walksIn = agent.kind === "intern" && !agent.id.startsWith("demo:");
      targets[agent.id] = toTarget(seat, walksIn ? centerDoor : arriving(agent.id));
    });
  }
  [...centerStay]
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((agent, index) => {
      const spot = layout.center.stand[index % layout.center.stand.length];
      targets[agent.id] = toTarget(spot, arriving(agent.id));
    });

  // Lazer: sala preferida por hash, com transbordo para as outras e depois para a espera.
  const used = new Map<string, number>();
  let waitingIndex = 0;
  let visits = 0;
  for (const agent of overflow) {
    targets[agent.id] = toTarget(layout.waiting[waitingIndex % Math.max(layout.waiting.length, 1)], arriving(agent.id));
    waitingIndex += 1;
  }
  for (const agent of leavers) {
    if (
      visits < MAX_VISITS &&
      agent.kind !== "intern" &&
      unitHash(`${agent.id}:visita:${visitWindow}`) < VISIT_CHANCE
    ) {
      targets[agent.id] = toTarget(layout.center.visits[visits], arriving(agent.id));
      visits += 1;
      continue;
    }
    const start = Math.floor(unitHash(`${agent.id}:sala:${leisureWindow}`) * LEISURE_ROOMS.length);
    let spot: Spot | null = null;
    for (let step = 0; step < LEISURE_ROOMS.length && !spot; step += 1) {
      const id = LEISURE_ROOMS[(start + step) % LEISURE_ROOMS.length].id;
      const taken = used.get(id) ?? 0;
      const spots = layout.leisure[id] ?? [];
      if (taken < spots.length) {
        spot = spots[taken];
        used.set(id, taken + 1);
      }
    }
    if (!spot) {
      spot = layout.waiting[waitingIndex % Math.max(layout.waiting.length, 1)];
      waitingIndex += 1;
    }
    targets[agent.id] = toTarget(spot, arriving(agent.id));
  }
  return targets;
}
