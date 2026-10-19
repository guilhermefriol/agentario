import { CANVAS_H, CANVAS_W } from "@/features/retro-office/core/constants";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import { decorationItems, EMPTY_DECORATION, type Decoration } from "@/features/tv/decoration";
import {
  CELL,
  LEISURE_H,
  LEISURE_ROOMS,
  LEISURE_W,
  centerContents,
  doorCenterX,
  itemFactory,
  leisureContents,
  projectRoomContents,
  projectRoomSize,
  roomWalls,
} from "@/features/tv/layout/rooms";
import { snapSpots } from "@/features/tv/layout/snap";
import type { Layout, LayoutDemand, LayoutRoom, LeisureId, Spot, Zone } from "@/features/tv/layout/types";

export const MARGIN = 2 * CELL;
export const GAP = CELL;
const ROW_CORRIDOR = 3 * CELL; // a folga das paredes fecha um vão de uma célula
const USABLE = CANVAS_W - 2 * MARGIN;
const MAX_COLS = 4;

/** Coloca retângulos da esquerda para a direita, quebrando a linha na largura útil. */
export function flow(sizes: Array<{ w: number; h: number }>, top: number, rowGap: number) {
  const positions: Array<{ x: number; y: number }> = [];
  let x = MARGIN;
  let y = top;
  let rowH = 0;
  for (const size of sizes) {
    if (x > MARGIN && x + size.w > MARGIN + USABLE) {
      x = MARGIN;
      y += rowH + rowGap;
      rowH = 0;
    }
    positions.push({ x, y });
    x += size.w + GAP;
    rowH = Math.max(rowH, size.h);
  }
  return { positions, bottom: sizes.length ? y + rowH : top };
}

/** Lugares de espera, um por célula, em fileiras de corredor. */
export function waitingSpots(count: number, top: number): { spots: Spot[]; bottom: number } {
  const perRow = Math.floor(USABLE / CELL) - 2;
  const rows = Math.max(1, Math.ceil(count / perRow));
  const spots: Spot[] = [];
  for (let i = 0; i < count; i += 1) {
    spots.push({
      x: MARGIN + CELL + (i % perRow) * CELL + CELL / 2,
      y: top + Math.floor(i / perRow) * CELL + CELL / 2,
      facing: 0,
      pose: "stand",
    });
  }
  return { spots, bottom: top + rows * CELL };
}

/** Fileira centralizada com a sala do Friol e as 5 salas de lazer, portas para o corredor de cima. */
export function bottomRow(top: number) {
  const zones: Zone[] = [];
  const furniture: FurnitureItem[] = [];
  const leisure = {} as Record<LeisureId, Spot[]>;
  const ids = ["centro", ...LEISURE_ROOMS.map((room) => room.id)] as const;
  const rowWidth = ids.length * LEISURE_W + (ids.length - 1) * GAP;
  const left = MARGIN + Math.floor((USABLE - rowWidth) / 2 / CELL) * CELL;
  let center: ReturnType<typeof centerContents> | null = null;
  let flags: Layout["flags"] = null;
  let centerDoor = { x: 0, y: 0 };

  ids.forEach((id, index) => {
    const x = left + index * (LEISURE_W + GAP);
    const doorX = doorCenterX({ x, w: LEISURE_W });
    const zone: Zone = {
      id: id === "centro" ? "centro" : `lazer:${id}`,
      kind: id === "centro" ? "center" : "leisure",
      label: id === "centro" ? null : LEISURE_ROOMS.find((room) => room.id === id)!.label,
      x,
      y: top,
      w: LEISURE_W,
      h: LEISURE_H,
      lit: true,
      door: { x: doorX, y: top - CELL / 2 },
    };
    const make = itemFactory(zone.id);
    zones.push(zone);
    furniture.push(...roomWalls(zone, "top", make));
    if (id === "centro") {
      center = centerContents(zone, make);
      furniture.push(...center.furniture);
      centerDoor = zone.door;
      // Do lado de fora da porta, para quem olha a porta: Rússia à direita (oeste), Brasil à esquerda (leste).
      flags = {
        russia: { x: doorX - 3 * CELL, y: top - CELL },
        brazil: { x: doorX + 3 * CELL, y: top - CELL },
      };
    } else {
      const contents = leisureContents(id, zone, make);
      furniture.push(...contents.furniture);
      leisure[id] = contents.spots;
    }
  });
  const c = center!;
  return {
    zones,
    furniture,
    leisure,
    center: { friol: c.friol, visits: c.visits, stand: c.stand, fiscal: c.fiscal, door: centerDoor },
    flags,
    bottom: top + LEISURE_H,
  };
}

type LayoutParts = Pick<Layout, "seatsByRoom" | "fiscalByRoom" | "leisure" | "center" | "waiting">;

/** Aplica o encaixe na grade a todos os lugares, preservando a estrutura. */
export function snapLayoutSpots(
  furniture: FurnitureItem[],
  zones: Zone[],
  parts: LayoutParts,
  origins: Array<{ x: number; y: number }>,
): LayoutParts {
  const roomIds = Object.keys(parts.seatsByRoom);
  const fiscalIds = Object.keys(parts.fiscalByRoom);
  const leisureIds = Object.keys(parts.leisure) as LeisureId[];
  const groups: Spot[][] = [
    [parts.center.friol, parts.center.fiscal],
    parts.center.visits,
    parts.center.stand,
    ...roomIds.map((id) => parts.seatsByRoom[id]),
    fiscalIds.map((id) => parts.fiscalByRoom[id]),
    ...leisureIds.map((id) => parts.leisure[id]),
    parts.waiting,
  ];
  const snapped = snapSpots(furniture, zones, groups, origins);
  let i = 0;
  const [friol, fiscal] = snapped[i++];
  const visits = snapped[i++];
  const stand = snapped[i++];
  const seatsByRoom: Record<string, Spot[]> = {};
  for (const id of roomIds) seatsByRoom[id] = snapped[i++];
  const fiscalSpots = snapped[i++];
  const fiscalByRoom: Record<string, Spot> = {};
  fiscalIds.forEach((id, k) => (fiscalByRoom[id] = fiscalSpots[k]));
  const leisure = {} as Record<LeisureId, Spot[]>;
  for (const id of leisureIds) leisure[id] = snapped[i++];
  const waiting = snapped[i++];
  return {
    seatsByRoom,
    fiscalByRoom,
    leisure,
    center: { ...parts.center, friol, fiscal, visits, stand },
    waiting,
  };
}

export type DecorationInput = {
  decoration: Decoration;
  /** Zonas cujos itens que bloqueiam passagem (e paredes) entram; o resto entra só com o que não bloqueia. */
  blockingZones: ReadonlySet<string> | "all" | "none";
};

export const NO_DECORATION: DecorationInput = { decoration: EMPTY_DECORATION, blockingZones: "none" };

const colsFor = (room: LayoutRoom, demand: LayoutDemand, maxCols: number) =>
  Math.min(Math.max(demand.colsByRoom[room.id] ?? 1, 1), maxCols);

/**
 * O escritório: um andar com todas as salas (acesas e apagadas) em ordem estável, um corredor com
 * a área de espera e, embaixo, a sala do Friol e o lazer. A largura das salas vem dos funcionários
 * cadastrados; se não couber, o teto de mesas por sala diminui até caber (quem sobra fica de pé).
 */
export function buildOfficeLayout(
  rooms: LayoutRoom[],
  demand: LayoutDemand,
  decor: DecorationInput = NO_DECORATION,
): Layout {
  const waitingRows = Math.ceil(Math.max(demand.population, 1) / (Math.floor(USABLE / CELL) - 2));
  const below = CELL + waitingRows * CELL + 2 * CELL + LEISURE_H + MARGIN;
  const roomsBottom = (maxCols: number) =>
    flow(rooms.map((room) => projectRoomSize(colsFor(room, demand, maxCols))), MARGIN, ROW_CORRIDOR).bottom;
  const maxCols = [MAX_COLS, 3, 2, 1].find((cols) => roomsBottom(cols) + below <= CANVAS_H) ?? 1;

  const sizes = rooms.map((room) => projectRoomSize(colsFor(room, demand, maxCols)));
  const placed = flow(sizes, MARGIN, ROW_CORRIDOR);
  const zones: Zone[] = [];
  const furniture: FurnitureItem[] = [];
  const seatsByRoom: Record<string, Spot[]> = {};
  const fiscalByRoom: Record<string, Spot> = {};

  rooms.forEach((room, index) => {
    const { x, y } = placed.positions[index];
    const { w, h } = sizes[index];
    const zone: Zone = {
      id: room.id,
      kind: "project",
      label: room.label,
      x,
      y,
      w,
      h,
      lit: room.lit,
      door: { x: doorCenterX({ x, w }), y: y + h + CELL / 2 },
    };
    const make = itemFactory(room.id);
    zones.push(zone);
    furniture.push(...roomWalls(zone, "bottom", make));
    const need = Math.max(demand.seatsByRoom[room.id] ?? 0, 1);
    const contents = projectRoomContents(zone, colsFor(room, demand, maxCols), need, make);
    furniture.push(...contents.furniture);
    seatsByRoom[room.id] = contents.seats;
    fiscalByRoom[room.id] = contents.fiscal;
  });

  const waiting = waitingSpots(Math.max(demand.population, 1), placed.bottom + CELL);
  const bottom = bottomRow(waiting.bottom + 2 * CELL);
  zones.push(...bottom.zones);
  furniture.push(...bottom.furniture);
  furniture.push(...decorationItems(zones, decor.decoration, { blockingZones: decor.blockingZones }));

  const parts = snapLayoutSpots(
    furniture,
    zones,
    { seatsByRoom, fiscalByRoom, leisure: bottom.leisure, center: bottom.center, waiting: waiting.spots },
    [bottom.center.door],
  );
  // Limites recortados ao conteúdo (a câmera enquadra só o que existe).
  const maxX = Math.max(...zones.map((zone) => zone.x + zone.w));
  return {
    furniture,
    bounds: { minX: 0, minY: 0, maxX: Math.min(CANVAS_W, maxX + MARGIN), maxY: bottom.bottom + MARGIN },
    zones,
    ...parts,
    flags: bottom.flags,
  };
}
