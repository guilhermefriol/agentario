import { buildNavGrid } from "@/features/retro-office/core/navigation";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import { cellOf, reachableCells } from "@/features/tv/layout/snap";
import type { Layout, Spot, Zone } from "@/features/tv/layout/types";

export type LayoutIssue = { zoneId: string | null; reason: "lugar" | "porta" | "repetido" };

const allSpots = (layout: Layout): Spot[] => [
  ...Object.values(layout.seatsByRoom).flat(),
  ...Object.values(layout.fiscalByRoom),
  ...Object.values(layout.leisure).flat(),
  layout.center.friol,
  layout.center.fiscal,
  ...layout.center.visits,
  ...layout.center.stand,
  ...layout.waiting,
];

const zoneAt = (zones: Zone[], x: number, y: number) =>
  zones.find((zone) => x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h) ?? null;

function checkPlane(
  furniture: FurnitureItem[],
  zones: Zone[],
  spots: Spot[],
  origins: Array<{ x: number; y: number }>,
): LayoutIssue[] {
  const grid = buildNavGrid(furniture);
  const reachable = reachableCells(grid, origins);
  const issues: LayoutIssue[] = [];
  const used = new Set<number>();
  for (const spot of spots) {
    const cell = cellOf(spot.x, spot.y);
    const zoneId = zoneAt(zones, spot.x, spot.y)?.id ?? null;
    if (!reachable.has(cell)) issues.push({ zoneId, reason: "lugar" });
    else if (used.has(cell)) issues.push({ zoneId, reason: "repetido" });
    used.add(cell);
  }
  for (const zone of zones) {
    if (!reachable.has(cellOf(zone.door.x, zone.door.y))) issues.push({ zoneId: zone.id, reason: "porta" });
  }
  return issues;
}

/**
 * Problemas de navegação do layout, com a mesma grade e alcance do A* da cena: todo lugar
 * numa célula livre, distinta e alcançável a partir da entrada (porta do centro ou elevador
 * do andar), e toda porta de zona alcançável. Lista vazia = layout válido.
 */
export function layoutIssues(layout: Layout): LayoutIssue[] {
  const spots = allSpots(layout);
  if (layout.kind !== "andares") {
    return checkPlane(layout.furniture, layout.zones, spots, [layout.center.door]);
  }
  return layout.floorPlans.flatMap((plan) => {
    const origins = [plan.elevator, ...(plan.zones.some((z) => z.kind === "center") ? [layout.center.door] : [])];
    return checkPlane(
      plan.furniture,
      plan.zones,
      spots.filter((spot) => spot.floor === plan.floor),
      origins,
    );
  });
}
