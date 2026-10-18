import type { AgentDirectedTarget } from "@/features/retro-office/core/types";
import type { Layout } from "@/features/tv/layout/types";

const WALK_PX_PER_SECOND = 18;
const ELEVATOR_RIDE_MS = 2000;
const MAX_TRANSIT_MS = 25_000;

type AgentFloorState = {
  floor: number;
  sceneId: string;
  last: { x: number; y: number };
  transit?: { fromSceneId: string; fromFloor: number; until: number };
};

/** Estado imutável: personagem → andar atual e viagem em curso. */
export type FloorTransitState = Readonly<Record<string, AgentFloorState>>;

export type FloorScene = {
  /** Alvo por entidade de cena (no layout "andares" o id é `agente@andar`). */
  targets: Record<string, AgentDirectedTarget>;
  /** Entidade de cena → id do personagem. */
  agentOf: Record<string, string>;
};

/** Cena sem andares: cada personagem é a própria entidade. */
export function flatScene(targets: Record<string, AgentDirectedTarget>): FloorScene {
  const agentOf: Record<string, string> = {};
  for (const id of Object.keys(targets)) agentOf[id] = id;
  return { targets, agentOf };
}

/**
 * Distribui os personagens pelos andares (função pura). Quem muda de andar: a entidade do
 * andar de origem caminha até o elevador e some depois da viagem; a do destino surge no
 * elevador do novo andar e caminha até o alvo.
 */
export function planFloorScene(
  layout: Layout,
  targets: Record<string, AgentDirectedTarget & { spawnFloor?: number }>,
  previous: FloorTransitState,
  now: number,
): { scene: FloorScene; state: FloorTransitState } {
  if (layout.kind !== "andares") return { scene: flatScene(targets), state: {} };
  const bandOf = (floor: number) => layout.floorPlans.find((plan) => plan.floor === floor);
  const floorOf = (target: { floor?: number }) => target.floor ?? 0;
  const state: Record<string, AgentFloorState> = {};
  const sceneTargets: Record<string, AgentDirectedTarget> = {};
  const agentOf: Record<string, string> = {};

  for (const [id, target] of Object.entries(targets)) {
    const floor = floorOf(target);
    const band = bandOf(floor);
    const before = previous[id];
    let entry: AgentFloorState;
    if (!before) {
      entry = { floor, sceneId: `${id}@${floor}`, last: { x: target.x, y: target.y } };
    } else if (before.floor !== floor) {
      const fromBand = bandOf(before.floor);
      const walkMs = fromBand
        ? (Math.hypot(fromBand.elevator.x - before.last.x, fromBand.elevator.y - before.last.y) /
            WALK_PX_PER_SECOND) *
          1000
        : 0;
      entry = {
        floor,
        sceneId: `${id}@${floor}`,
        last: before.last,
        transit: {
          fromSceneId: before.sceneId,
          fromFloor: before.floor,
          until: now + Math.min(walkMs + ELEVATOR_RIDE_MS, MAX_TRANSIT_MS),
        },
      };
    } else {
      entry = { ...before };
    }

    if (entry.transit && now < entry.transit.until) {
      const fromBand = bandOf(entry.transit.fromFloor);
      if (fromBand) {
        sceneTargets[entry.transit.fromSceneId] = {
          x: fromBand.elevator.x,
          y: fromBand.elevator.y,
          pose: "stand",
        };
        agentOf[entry.transit.fromSceneId] = id;
      }
      state[id] = entry;
      continue;
    }
    const arrivedByElevator = Boolean(entry.transit);
    // Quem nasce longe do próprio andar (ex.: estagiário vindo do centro) surge no elevador.
    const spawnFrom =
      arrivedByElevator || (target.spawnFrom && target.spawnFloor !== undefined && target.spawnFloor !== floor)
        ? band?.elevator
        : target.spawnFrom;
    const sceneTarget: AgentDirectedTarget & { spawnFloor?: number } = { ...target, spawnFrom };
    delete sceneTarget.spawnFloor;
    sceneTargets[entry.sceneId] = sceneTarget;
    agentOf[entry.sceneId] = id;
    state[id] = { floor: entry.floor, sceneId: entry.sceneId, last: { x: target.x, y: target.y } };
  }
  return { scene: { targets: sceneTargets, agentOf }, state };
}
