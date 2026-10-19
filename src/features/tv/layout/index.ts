import { blockingZoneIds, EMPTY_DECORATION, type Decoration } from "@/features/tv/decoration";
import { buildOfficeLayout, NO_DECORATION, type DecorationInput } from "@/features/tv/layout/build";
import type { Layout, LayoutDemand, LayoutRoom } from "@/features/tv/layout/types";
import { layoutIssues } from "@/features/tv/layout/validate";

export function buildLayout(
  rooms: LayoutRoom[],
  demand: LayoutDemand,
  decor: DecorationInput = NO_DECORATION,
): Layout {
  return buildOfficeLayout(rooms, demand, decor);
}

/**
 * Layout com a decoração, à prova de falha: se algo ficar inalcançável, descarta os itens que
 * bloqueiam passagem (e paredes) zona a zona; se ainda assim falhar, usa só a decoração que
 * não bloqueia (a planta base é sempre válida). Devolve também as zonas descartadas.
 */
export function buildSafeLayout(
  rooms: LayoutRoom[],
  demand: LayoutDemand,
  decoration: Decoration = EMPTY_DECORATION,
): { layout: Layout; dropped: string[] } {
  const candidates = blockingZoneIds(decoration);
  const kept = new Set(candidates);
  let layout = buildLayout(rooms, demand, { decoration, blockingZones: kept });
  if (layoutIssues(layout).length === 0) return { layout, dropped: [] };
  for (const zoneId of candidates) {
    kept.delete(zoneId);
    layout = buildLayout(rooms, demand, { decoration, blockingZones: kept });
    if (layoutIssues(layout).length === 0) return { layout, dropped: candidates.filter((id) => !kept.has(id)) };
  }
  return {
    layout: buildLayout(rooms, demand, { decoration, blockingZones: "none" }),
    dropped: candidates,
  };
}

export { layoutIssues } from "@/features/tv/layout/validate";
export * from "@/features/tv/layout/types";
