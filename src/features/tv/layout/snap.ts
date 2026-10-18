import { CANVAS_H, CANVAS_W } from "@/features/retro-office/core/constants";
import { buildNavGrid } from "@/features/retro-office/core/navigation";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import { CELL } from "@/features/tv/layout/rooms";
import type { Spot, Zone } from "@/features/tv/layout/types";

const COLS = Math.ceil(CANVAS_W / CELL);
const ROWS = Math.ceil(CANVAS_H / CELL);
const MAX_RADIUS = 10;

const cellOf = (x: number, y: number) => {
  const c = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor(y / CELL)));
  return r * COLS + c;
};
const centerOf = (index: number) => ({
  x: (index % COLS) * CELL + CELL / 2,
  y: Math.floor(index / COLS) * CELL + CELL / 2,
});

/** Células livres alcançáveis a partir das origens (vizinhança de 4). */
function reachableCells(grid: Uint8Array, origins: Array<{ x: number; y: number }>): Set<number> {
  const seen = new Set<number>();
  const queue: number[] = [];
  for (const origin of origins) {
    const start = cellOf(origin.x, origin.y);
    if (!grid[start] && !seen.has(start)) {
      seen.add(start);
      queue.push(start);
    }
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    const c = current % COLS;
    const r = Math.floor(current / COLS);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const next = nr * COLS + nc;
      if (grid[next] || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

const inside = (zone: Zone | undefined, x: number, y: number) =>
  !zone || (x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.h);

/**
 * Garante que cada lugar fique numa célula livre, alcançável a partir das origens e sem
 * repetir célula: quem não estiver vai para a célula válida mais próxima dentro da própria
 * zona. Mantém pose e direção. Devolve grupos novos na mesma ordem.
 */
export function snapSpots(
  furniture: FurnitureItem[],
  zones: Zone[],
  groups: Spot[][],
  origins: Array<{ x: number; y: number }>,
): Spot[][] {
  const grid = buildNavGrid(furniture);
  const reachable = reachableCells(grid, origins);
  const used = new Set<number>();
  return groups.map((spots) =>
    spots.map((spot) => {
      const zone = zones.find((z) => inside(z, spot.x, spot.y));
      const own = cellOf(spot.x, spot.y);
      if (reachable.has(own) && !used.has(own)) {
        used.add(own);
        return spot;
      }
      const c0 = own % COLS;
      const r0 = Math.floor(own / COLS);
      for (let radius = 1; radius <= MAX_RADIUS; radius += 1) {
        let best: number | null = null;
        let bestDistance = Infinity;
        for (let dr = -radius; dr <= radius; dr += 1) {
          for (let dc = -radius; dc <= radius; dc += 1) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== radius) continue;
            const c = c0 + dc;
            const r = r0 + dr;
            if (c < 0 || r < 0 || c >= COLS || r >= ROWS) continue;
            const index = r * COLS + c;
            const center = centerOf(index);
            if (!reachable.has(index) || used.has(index) || !inside(zone, center.x, center.y)) continue;
            const distance = Math.hypot(center.x - spot.x, center.y - spot.y);
            if (distance < bestDistance) {
              best = index;
              bestDistance = distance;
            }
          }
        }
        if (best !== null) {
          used.add(best);
          return { ...spot, ...centerOf(best) };
        }
      }
      return spot;
    }),
  );
}
