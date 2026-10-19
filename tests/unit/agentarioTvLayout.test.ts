// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CANVAS_H, CANVAS_W } from "@/features/retro-office/core/constants";
import { astar, buildNavGrid } from "@/features/retro-office/core/navigation";
import type { AgentarioAgent } from "@/features/tv/agentarioAgents";
import { applyDemo } from "@/features/tv/demo";
import { buildLayout, layoutIssues, type Layout, type LayoutRoom, type Spot } from "@/features/tv/layout";
import { LEISURE_ROOMS } from "@/features/tv/layout/rooms";
import { assignTargets, layoutDemand } from "@/features/tv/movement";
import { fitCamera, isNight } from "@/features/tv/view";

// Salas e pessoas fictícias, com distribuição de funcionários parecida com a real (poucos projetos com muitos).
const rooms: LayoutRoom[] = Array.from({ length: 34 }, (_, i) => ({
  id: `p-${String(i).padStart(10, "0")}`,
  label: `Projeto ${i}`,
  lit: i % 5 === 0,
}));
const STAFF_BY_ROOM: Record<number, number> = { 0: 8, 3: 3, 7: 3, 12: 3 };

const person = (
  id: string,
  roomId: string | null,
  status: "working" | "idle",
  kind: AgentarioAgent["kind"] = "session",
): AgentarioAgent => ({
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
    ...(room.lit ? [person(`s-${i}`, room.id, "working")] : []),
    ...Array.from({ length: STAFF_BY_ROOM[i] ?? 0 }, (_, k) => person(`a-${i}-${k}`, room.id, "idle", "staff")),
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

function expectValid(layout: Layout) {
  for (const [i, a] of layout.zones.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w).toBeLessThanOrEqual(CANVAS_W);
    expect(a.y + a.h).toBeLessThanOrEqual(CANVAS_H);
    for (const b of layout.zones.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
  }
  expect(layoutIssues(layout)).toEqual([]);
  expect(allSpots(layout).filter((spot) => !reachable(layout, layout.center.door, spot))).toEqual([]);
}

describe("escritório (um andar com todas as salas)", () => {
  it("mostra as 34 salas (acesas e apagadas), o centro e o lazer; tudo cabe e é alcançável", () => {
    const layout = buildLayout(rooms, demand);
    const projectZones = layout.zones.filter((z) => z.kind === "project");
    expect(projectZones.map((z) => z.id)).toEqual(rooms.map((r) => r.id));
    expect(projectZones.filter((z) => z.lit)).toHaveLength(rooms.filter((r) => r.lit).length);
    expect(layout.zones.filter((z) => z.kind === "leisure").map((z) => z.label)).toEqual(
      LEISURE_ROOMS.map((room) => room.label),
    );
    expect(layout.zones.find((z) => z.kind === "center")?.label).toBeNull();
    expectValid(layout);
  });

  it("sala com mais funcionários ganha mais mesas", () => {
    const layout = buildLayout(rooms, demand);
    const width = (id: string) => layout.zones.find((z) => z.id === id)!.w;
    expect(width(rooms[0].id)).toBeGreaterThan(width(rooms[1].id));
  });

  it("pior caso (todas as salas pedindo muitas mesas) ainda cabe, reduzindo o teto de mesas", () => {
    const colsByRoom = Object.fromEntries(rooms.map((room) => [room.id, 9]));
    const seatsByRoom = Object.fromEntries(rooms.map((room) => [room.id, 9]));
    const layout = buildLayout(rooms, { colsByRoom, seatsByRoom, population: 400 });
    expectValid(layout);
  });

  it("a planta não muda quando sessões entram e saem", () => {
    const base = buildLayout(rooms, demand);
    const more = [...people, ...Array.from({ length: 6 }, (_, i) => person(`extra-${i}`, rooms[5].id, "working"))];
    const after = buildLayout(rooms, { ...layoutDemand(more), population: demand.population });
    expect(after.zones.map((z) => [z.x, z.y, z.w, z.h])).toEqual(base.zones.map((z) => [z.x, z.y, z.w, z.h]));
  });

  it("com tudo aceso (demonstração) continua válido", () => {
    const demo = applyDemo(rooms, people, 0);
    expectValid(buildLayout(demo.rooms, layoutDemand(demo.agents)));
  });

  it("é determinístico", () => {
    expect(JSON.stringify(buildLayout(rooms, demand))).toEqual(JSON.stringify(buildLayout(rooms, demand)));
  });
});

describe("movimento", () => {
  const layout = buildLayout(rooms, demand);
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
    const big = buildLayout(rooms, layoutDemand(crowd));
    const t = assignTargets({ layout: big, rooms, agents: crowd, now });
    const waitingKeys = new Set(big.waiting.map((s) => `${s.x},${s.y}`));
    expect(Object.values(t).filter((s) => waitingKeys.has(`${s.x},${s.y}`)).length).toBeGreaterThan(0);
    const keys = Object.values(t).map((s) => `${s.x},${s.y}`);
    expect(new Set(keys).size).toBe(keys.length);
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
    const big = fitCamera({ minX: 0, minY: 0, maxX: 3200, maxY: 1600 }, { width: 1920, height: 1080 });
    expect(big.zoom).toBeGreaterThan(0);
    expect(big.zoom).toBeLessThan(small.zoom);
    expect(big).toMatchObject({ x: 1600, y: 800 });
  });
});
