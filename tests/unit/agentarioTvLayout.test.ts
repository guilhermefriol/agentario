// @vitest-environment node
import { describe, expect, it } from "vitest";
import { astar, buildNavGrid } from "@/features/retro-office/core/navigation";
import type { AgentarioAgent } from "@/features/tv/agentarioAgents";
import { applyDemo } from "@/features/tv/demo";
import { planFloorScene, type FloorTransitState } from "@/features/tv/floorTransit";
import { buildLayout, type Layout, type LayoutRoom, type Spot } from "@/features/tv/layout";
import { LEISURE_ROOMS } from "@/features/tv/layout/rooms";
import { assignTargets, layoutDemand } from "@/features/tv/movement";
import { fitCamera, isNight } from "@/features/tv/view";

// Salas e pessoas fictícias.
const rooms: LayoutRoom[] = Array.from({ length: 34 }, (_, i) => ({
  id: `p-${String(i).padStart(2, "0")}`,
  label: `Projeto ${i}`,
  lit: i % 5 === 0,
}));

const person = (id: string, roomId: string | null, status: "working" | "idle", kind: AgentarioAgent["kind"] = "session"): AgentarioAgent => ({
  id,
  name: id,
  kind,
  role: null,
  status,
  task: status === "working" ? "Rodando comando" : null,
  room: roomId,
  roomId,
});

const people: AgentarioAgent[] = [
  person("friol", null, "idle", "owner"),
  ...rooms.flatMap((room, i) => [
    person(`s-${i}`, room.id, room.lit ? "working" : "idle"),
    person(`a-${i}`, room.id, "idle", "staff"),
  ]),
  person("c-1", null, "idle"),
  person("f-0", rooms[0].id, "working", "fiscal"),
];

const demand = layoutDemand(people);

function reachable(layout: Layout, from: { x: number; y: number }, spot: Spot) {
  const grid = buildNavGrid(layout.furniture);
  if (Math.hypot(from.x - spot.x, from.y - spot.y) < 1) return true;
  return astar(from.x, from.y, spot.x, spot.y, grid).length > 0;
}

const allSpots = (layout: Layout) => [
  ...Object.values(layout.seatsByRoom).flat(),
  ...Object.values(layout.fiscalByRoom),
  ...Object.values(layout.leisure).flat(),
  layout.center.friol,
  ...layout.center.visits,
  ...layout.center.stand,
  layout.center.fiscal,
  ...layout.waiting,
];

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("layouts planos", () => {
  for (const kind of ["acesas", "baias"] as const) {
    it(`${kind}: salas sem sobreposição, dentro do canvas e todo lugar alcançável`, () => {
      const layout = buildLayout(kind, rooms, demand);
      for (const [i, a] of layout.zones.entries()) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y + a.h).toBeLessThanOrEqual(1800);
        expect(a.x + a.w).toBeLessThanOrEqual(1800);
        for (const b of layout.zones.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
      }
      const unreachable = allSpots(layout).filter((spot) => !reachable(layout, layout.center.door, spot));
      expect(unreachable).toEqual([]);
      expect(layout.zones.filter((z) => z.kind === "leisure").map((z) => z.label)).toEqual(
        LEISURE_ROOMS.map((room) => room.label),
      );
      expect(layout.zones.find((z) => z.kind === "center")?.label).toBeNull();
    });
  }

  it("acesas mostra só as salas acesas e lista as apagadas", () => {
    const layout = buildLayout("acesas", rooms, demand);
    const shown = layout.zones.filter((z) => z.kind === "project").map((z) => z.id);
    expect(shown).toEqual(rooms.filter((r) => r.lit).map((r) => r.id));
    expect(layout.hiddenRooms).toHaveLength(rooms.filter((r) => !r.lit).length);
  });

  it("acesas com todas as salas acesas (demonstração) ainda cabe e é alcançável", () => {
    const allLit = rooms.map((room) => ({ ...room, lit: true }));
    const layout = buildLayout("acesas", allLit, demand);
    expect(layout.zones.filter((z) => z.kind === "project")).toHaveLength(34);
    expect(Math.max(...layout.zones.map((z) => z.y + z.h))).toBeLessThanOrEqual(1800);
    expect(allSpots(layout).filter((spot) => !reachable(layout, layout.center.door, spot))).toEqual([]);
  });

  it("é determinístico", () => {
    expect(JSON.stringify(buildLayout("baias", rooms, demand))).toEqual(
      JSON.stringify(buildLayout("baias", rooms, demand)),
    );
  });
});

describe("andares", () => {
  const layout = buildLayout("andares", rooms, demand);

  it("terraço é o andar mais alto e tem o Friol e as 5 salas de lazer", () => {
    const terrace = Math.max(...layout.floorPlans.map((plan) => plan.floor));
    expect(layout.floors).toBe(terrace);
    const terraceZones = layout.zones.filter((zone) => zone.floor === terrace);
    expect(terraceZones.map((zone) => zone.kind).sort()).toEqual(["center", ...Array(5).fill("leisure")].sort());
    expect(layout.zones.filter((z) => z.kind === "project").every((z) => z.floor < terrace)).toBe(true);
  });

  it("cada lugar tem andar e é alcançável pelo elevador do próprio andar", () => {
    const spots = allSpots(layout);
    expect(spots.every((spot) => typeof spot.floor === "number")).toBe(true);
    for (const plan of layout.floorPlans) {
      const grid = buildNavGrid(plan.furniture);
      const own = spots.filter((spot) => spot.floor === plan.floor);
      expect(own.length).toBeGreaterThan(0);
      for (const spot of own) {
        expect(astar(plan.elevator.x, plan.elevator.y, spot.x, spot.y, grid).length).toBeGreaterThan(0);
      }
      for (const zone of plan.zones) {
        expect(zone.y + zone.h).toBeLessThanOrEqual(1800);
        expect(zone.x + zone.w).toBeLessThanOrEqual(1800);
      }
    }
  });
});

describe("movimento", () => {
  const layout = buildLayout("baias", rooms, demand);
  const now = Date.parse("2026-01-10T12:00:00Z");
  const targets = assignTargets({ layout, rooms, agents: people, now });
  const inZone = (id: string, zoneId: string) => {
    const zone = layout.zones.find((z) => z.id === zoneId)!;
    const t = targets[id];
    return t.x >= zone.x && t.x <= zone.x + zone.w && t.y >= zone.y && t.y <= zone.y + zone.h;
  };

  it("todos ganham alvo; Friol na mesa dele; quem trabalha fica na própria sala", () => {
    expect(Object.keys(targets).sort()).toEqual(people.map((p) => p.id).sort());
    expect(targets.friol).toMatchObject({ x: layout.center.friol.x, y: layout.center.friol.y, pose: "sit" });
    for (const p of people.filter((p) => p.status === "working" && p.kind === "session")) {
      expect(inZone(p.id, p.roomId!)).toBe(true);
    }
  });

  it("sala apagada fica vazia e no máximo 50% dos parados das acesas saem", () => {
    const darkIds = new Set(rooms.filter((r) => !r.lit).map((r) => r.id));
    for (const p of people.filter((p) => p.roomId && darkIds.has(p.roomId))) {
      expect(inZone(p.id, p.roomId!)).toBe(false);
    }
    const litIdle = people.filter(
      (p) => (!p.roomId || !darkIds.has(p.roomId)) && p.status === "idle" && p.kind !== "fiscal" && p.kind !== "owner",
    );
    const center = layout.zones.find((z) => z.kind === "center")!;
    const left = litIdle.filter((p) => !inZone(p.id, p.roomId ?? center.id));
    expect(left.length).toBeLessThanOrEqual(Math.floor(litIdle.length * 0.5));
  });

  it("ninguém divide o mesmo lugar", () => {
    const keys = Object.values(targets).map((t) => `${t.x},${t.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("lazer cheio transborda para a espera", () => {
    const crowd = Array.from({ length: 120 }, (_, i) => person(`x-${i}`, rooms[1].id, "idle"));
    const big = buildLayout("baias", rooms, layoutDemand(crowd));
    const t = assignTargets({ layout: big, rooms, agents: crowd, now });
    const waitingKeys = new Set(big.waiting.map((s) => `${s.x},${s.y}`));
    expect(Object.values(t).filter((s) => waitingKeys.has(`${s.x},${s.y}`)).length).toBeGreaterThan(0);
    const keys = Object.values(t).map((s) => `${s.x},${s.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("trânsito entre andares", () => {
  const layout = buildLayout("andares", rooms, demand);
  const terrace = layout.floorPlans.at(-1)!;
  const deskSpot = layout.seatsByRoom[rooms[0].id][0];
  const leisureSpot = layout.leisure.academia[0];

  it("quem muda de andar vai até o elevador, viaja e surge no elevador do destino", () => {
    const t0 = 1_000_000;
    const at = (spot: Spot) => ({ x: spot.x, y: spot.y, pose: spot.pose, floor: spot.floor });
    let result = planFloorScene(layout, { a: at(deskSpot) }, {} as FloorTransitState, t0);
    const startFloor = deskSpot.floor!;
    expect(Object.keys(result.scene.targets)).toEqual([`a@${startFloor}`]);

    result = planFloorScene(layout, { a: at(leisureSpot) }, result.state, t0 + 1000);
    const fromBand = layout.floorPlans.find((plan) => plan.floor === startFloor)!;
    expect(result.scene.targets[`a@${startFloor}`]).toMatchObject({ x: fromBand.elevator.x, y: fromBand.elevator.y });
    expect(result.scene.targets[`a@${terrace.floor}`]).toBeUndefined();

    result = planFloorScene(layout, { a: at(leisureSpot) }, result.state, t0 + 60_000);
    expect(Object.keys(result.scene.targets)).toEqual([`a@${terrace.floor}`]);
    expect(result.scene.targets[`a@${terrace.floor}`].spawnFrom).toEqual(terrace.elevator);
  });
});

describe("demonstração", () => {
  it("acende tudo, põe um Claude trabalhando por sala e mantém os reais", () => {
    const real = people.slice(0, 5);
    const result = applyDemo(rooms, real, 0);
    expect(result.rooms.every((room) => room.lit)).toBe(true);
    for (const room of rooms) {
      expect(result.agents.some((a) => a.roomId === room.id && a.status === "working" && a.kind === "session")).toBe(true);
    }
    expect(result.agents.slice(0, 5)).toEqual(real);
    const fiscals = result.agents.filter((a) => a.kind === "fiscal");
    expect(fiscals.length).toBeGreaterThanOrEqual(1);
    expect(fiscals.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(applyDemo(rooms, real, 0))).toEqual(JSON.stringify(result));
    const names = result.agents.map((a) => a.name).filter((n) => n !== "Fiscal Codex");
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("vista", () => {
  it("modo noite aceita intervalo que cruza a meia-noite", () => {
    const night = { enabled: true, from: "22:00", to: "07:00" };
    expect(isNight(night, new Date(2026, 0, 1, 23, 0))).toBe(true);
    expect(isNight(night, new Date(2026, 0, 1, 6, 59))).toBe(true);
    expect(isNight(night, new Date(2026, 0, 1, 12, 0))).toBe(false);
    expect(isNight({ ...night, enabled: false }, new Date(2026, 0, 1, 23, 0))).toBe(false);
  });

  it("enquadra o layout com zoom positivo e menor para layouts maiores", () => {
    const small = fitCamera({ minX: 0, minY: 0, maxX: 600, maxY: 400 }, { width: 1920, height: 1080 });
    const big = fitCamera({ minX: 0, minY: 0, maxX: 1800, maxY: 1600 }, { width: 1920, height: 1080 });
    expect(big.zoom).toBeGreaterThan(0);
    expect(big.zoom).toBeLessThan(small.zoom);
    expect(big).toMatchObject({ x: 900, y: 800 });
  });
});
