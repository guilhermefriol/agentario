import type { FurnitureItem } from "@/features/retro-office/core/types";
import { CELL } from "@/features/tv/layout/rooms";
import type { Layout, Zone } from "@/features/tv/layout/types";

/** Itens de decoração: só os que não bloqueiam a passagem (a navegação nunca muda). */
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

export type DecorType = keyof typeof DECOR_TYPES;
export const DECOR_SLOTS = 8;
const MAX_ZONES = 80;
export const DECORATION_MAX_BYTES = 64 * 1024;

/** Decoração por zona: cada item ocupa um dos lugares fixos da sala (acompanha a sala em todo layout). */
export type Decoration = { version: 1; zones: Record<string, Array<{ type: DecorType; slot: number }>> };

export const EMPTY_DECORATION: Decoration = { version: 1, zones: {} };

const ZONE_KEY = /^(p-[0-9a-f]{10}|centro|lazer:(academia|banheiros|refeitorio|descanso|igreja))$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Valida e normaliza (descarta o que não respeitar o esquema). Lança erro se a raiz for inválida. */
export function normalizeDecoration(value: unknown): Decoration {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.zones)) {
    throw new Error("decoração inválida");
  }
  const zones: Decoration["zones"] = {};
  for (const [key, items] of Object.entries(value.zones).slice(0, MAX_ZONES)) {
    if (!ZONE_KEY.test(key) || !Array.isArray(items)) continue;
    const seen = new Set<number>();
    const clean: Decoration["zones"][string] = [];
    for (const item of items.slice(0, DECOR_SLOTS)) {
      if (!isRecord(item) || typeof item.type !== "string" || !(item.type in DECOR_TYPES)) continue;
      const slot = item.slot;
      if (typeof slot !== "number" || !Number.isInteger(slot) || slot < 0 || slot >= DECOR_SLOTS) continue;
      if (seen.has(slot)) continue;
      seen.add(slot);
      clean.push({ type: item.type as DecorType, slot });
    }
    if (clean.length > 0) zones[key] = clean;
  }
  return { version: 1, zones };
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

/** Itens de decoração para as zonas presentes (uma planta ou o layout plano). */
export function decorationItems(zones: Zone[], decoration: Decoration): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  for (const zone of zones) {
    for (const { type, slot } of decoration.zones[zone.id] ?? []) {
      items.push({ _uid: `decor:${zone.id}:${slot}`, type, ...decorSlot(zone, slot) });
    }
  }
  return items;
}

/** Zonas onde dá para decorar no layout atual, com nome para o painel. */
export function decorableZones(layout: Layout, zones: Zone[] = layout.zones) {
  return zones.map((zone) => ({ id: zone.id, label: zone.label ?? "Sala do Friol" }));
}
