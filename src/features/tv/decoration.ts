import { WALL_THICKNESS } from "@/features/retro-office/core/constants";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import { CELL } from "@/features/tv/layout/rooms";
import type { Layout, Zone } from "@/features/tv/layout/types";

/** Itens de decoração que não bloqueiam a passagem (não mudam a navegação). */
export const DECOR_TYPES = {
  lamp: "Luminária",
  trash: "Lixeira",
  clock: "Relógio",
  mug: "Caneca",
  computer: "Computador",
  coffee_machine: "Cafeteira",
  wall_cabinet: "Armário de parede",
  chair: "Cadeira",
  microwave: "Micro-ondas",
} as const;

/** Móveis que bloqueiam a passagem: só entram se a sala continuar navegável. */
export const BLOCKING_TYPES = {
  plant: "Planta",
  bookshelf: "Estante",
  couch: "Sofá",
  table_rect: "Mesa",
  water_cooler: "Bebedouro",
  vending: "Máquina de venda",
  fridge: "Geladeira",
} as const;

export type DecorType = keyof typeof DECOR_TYPES;
export type BlockingType = keyof typeof BLOCKING_TYPES;
export type ItemType = DecorType | BlockingType;

export const ITEM_LABELS: Record<ItemType, string> = { ...DECOR_TYPES, ...BLOCKING_TYPES };
export const isBlockingType = (type: ItemType): type is BlockingType => type in BLOCKING_TYPES;

export const DECOR_SLOTS = 8;
export const MAX_WALLS = 6;
const MAX_WALL_LEN = 12;
const MAX_CELL = 40;
const MAX_ZONES = 80;
export const DECORATION_MAX_BYTES = 64 * 1024;

/** Parede interna em células relativas à sala: começa em (c, r), `len` células na direção `dir`. */
export type DecorWall = { c: number; r: number; len: number; dir: "h" | "v" };
export type ZoneDecoration = { items: Array<{ type: ItemType; slot: number }>; walls: DecorWall[] };
export type Decoration = { version: 2; zones: Record<string, ZoneDecoration> };

export const EMPTY_DECORATION: Decoration = { version: 2, zones: {} };

const ZONE_KEY = /^(p-[0-9a-f]{10}|centro|lazer:(academia|banheiros|refeitorio|descanso|igreja))$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function normalizeItems(raw: unknown): ZoneDecoration["items"] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const items: ZoneDecoration["items"] = [];
  for (const item of raw.slice(0, DECOR_SLOTS)) {
    if (!isRecord(item) || typeof item.type !== "string" || !(item.type in ITEM_LABELS)) continue;
    if (!isInt(item.slot, 0, DECOR_SLOTS - 1) || seen.has(item.slot)) continue;
    seen.add(item.slot);
    items.push({ type: item.type as ItemType, slot: item.slot });
  }
  return items;
}

function normalizeWalls(raw: unknown): DecorWall[] {
  if (!Array.isArray(raw)) return [];
  const walls: DecorWall[] = [];
  for (const wall of raw.slice(0, MAX_WALLS)) {
    if (!isRecord(wall) || (wall.dir !== "h" && wall.dir !== "v")) continue;
    if (!isInt(wall.c, 1, MAX_CELL) || !isInt(wall.r, 1, MAX_CELL) || !isInt(wall.len, 1, MAX_WALL_LEN)) continue;
    walls.push({ c: wall.c, r: wall.r, len: wall.len, dir: wall.dir });
  }
  return walls;
}

/** Valida e normaliza (v1 = só itens por zona; v2 = itens e paredes). Lança erro se a raiz for inválida. */
export function normalizeDecoration(value: unknown): Decoration {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || !isRecord(value.zones)) {
    throw new Error("decoração inválida");
  }
  const zones: Decoration["zones"] = {};
  for (const [key, raw] of Object.entries(value.zones).slice(0, MAX_ZONES)) {
    if (!ZONE_KEY.test(key)) continue;
    const zone =
      value.version === 1
        ? { items: normalizeItems(raw), walls: [] }
        : isRecord(raw)
          ? { items: normalizeItems(raw.items), walls: normalizeWalls(raw.walls) }
          : null;
    if (zone && (zone.items.length > 0 || zone.walls.length > 0)) zones[key] = zone;
  }
  return { version: 2, zones };
}

/** Lugares fixos de decoração numa zona: cantos e meios das paredes, por dentro. */
export function decorSlot(zone: Pick<Zone, "x" | "y" | "w" | "h">, slot: number) {
  const cols = Math.round(zone.w / CELL);
  const rows = Math.round(zone.h / CELL);
  const midC = Math.floor(cols / 2);
  const midR = Math.floor(rows / 2);
  const cells: Array<[number, number]> = [
    [1, 1],
    [cols - 2, 1],
    [1, rows - 2],
    [cols - 2, rows - 2],
    [midC - 1, 1],
    [midC + 1, rows - 2],
    [1, midR],
    [cols - 2, midR],
  ];
  const [c, r] = cells[slot % cells.length];
  return { x: zone.x + c * CELL + 2, y: zone.y + r * CELL + 2 };
}

/** Parede interna cabe na zona (sem tocar as paredes externas)? */
export function wallFits(zone: Pick<Zone, "w" | "h">, wall: DecorWall): boolean {
  const cols = Math.round(zone.w / CELL);
  const rows = Math.round(zone.h / CELL);
  const endC = wall.dir === "h" ? wall.c + wall.len : wall.c + 1;
  const endR = wall.dir === "v" ? wall.r + wall.len : wall.r + 1;
  return wall.c >= 1 && wall.r >= 1 && endC <= cols - 1 && endR <= rows - 1;
}

/**
 * Itens de decoração das zonas dadas. `blocking: false` devolve só o que não bloqueia
 * passagem (usado pelo fail-safe quando a decoração completa deixaria algo inalcançável).
 */
export function decorationItems(
  zones: Zone[],
  decoration: Decoration,
  options: { blockingZones?: ReadonlySet<string> | "all" | "none" } = {},
): FurnitureItem[] {
  const blockingZones = options.blockingZones ?? "all";
  const allowBlocking = (zoneId: string) =>
    blockingZones === "all" ? true : blockingZones === "none" ? false : blockingZones.has(zoneId);
  const items: FurnitureItem[] = [];
  for (const zone of zones) {
    const decor = decoration.zones[zone.id];
    if (!decor) continue;
    for (const { type, slot } of decor.items) {
      if (isBlockingType(type) && !allowBlocking(zone.id)) continue;
      items.push({ _uid: `decor:${zone.id}:${slot}`, type, ...decorSlot(zone, slot) });
    }
    if (!allowBlocking(zone.id)) continue;
    decor.walls.forEach((wall, index) => {
      if (!wallFits(zone, wall)) return;
      items.push({
        _uid: `decor:${zone.id}:parede:${index}`,
        type: "wall",
        x: zone.x + wall.c * CELL,
        y: zone.y + wall.r * CELL,
        w: wall.dir === "h" ? wall.len * CELL : WALL_THICKNESS,
        h: wall.dir === "v" ? wall.len * CELL : WALL_THICKNESS,
      });
    });
  }
  return items;
}

/** Zonas com algo que bloqueia passagem (móvel grande ou parede). */
export function blockingZoneIds(decoration: Decoration): string[] {
  return Object.entries(decoration.zones)
    .filter(([, zone]) => zone.walls.length > 0 || zone.items.some((item) => isBlockingType(item.type)))
    .map(([id]) => id)
    .sort();
}

/** Zonas onde dá para decorar no layout atual, com nome para o painel. */
export function decorableZones(layout: Layout, zones: Zone[] = layout.zones) {
  return zones.map((zone) => ({ id: zone.id, label: zone.label ?? "Sala do Friol" }));
}
