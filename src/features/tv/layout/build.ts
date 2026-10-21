import { CANVAS_H, CANVAS_W } from "@/features/retro-office/core/constants";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import { decorationItems, EMPTY_DECORATION, type Decoration } from "@/features/tv/decoration";
import {
  CELL,
  LEISURE_H,
  LEISURE_ROOMS,
  LEISURE_W,
  ROOM_H,
  UNIT_STEP,
  accentFor,
  centerContents,
  desksFor,
  doorCenterX,
  itemFactory,
  leisureContents,
  projectRoomContents,
  projectRoomSize,
  roomWalls,
  waitingContents,
} from "@/features/tv/layout/rooms";
import { toNavFurniture } from "@/features/tv/layout/modelBounds";
import { snapSpots } from "@/features/tv/layout/snap";
import type { Layout, LayoutDemand, LayoutRoom, LeisureId, Spot, Zone } from "@/features/tv/layout/types";

export const MARGIN = 2 * CELL;
const CORRIDOR = 3 * CELL; // a folga das paredes fecha um vão de uma célula
const UNITS_PER_ROW = 9; // deixa passagens verticais nas pontas das fileiras
const ROWS_PER_SIDE = 3;
export const MAX_UNITS = UNITS_PER_ROW * ROWS_PER_SIDE * 2;
const FRIOL_W = 15 * CELL;
const WAITING_ROWS = LEISURE_H / CELL - 3;

const snapCell = (value: number) => Math.floor(value / CELL) * CELL;

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

type RowItem = { room: LayoutRoom; units: 1 | 2 };

/**
 * Fileiras de um lado da faixa central (em ordem): o menor número de fileiras de até
 * UNITS_PER_ROW unidades, com as salas espalhadas por igual entre elas.
 */
function packRows(items: RowItem[]): RowItem[][] {
  const total = items.reduce((sum, item) => sum + item.units, 0);
  if (total === 0) return [];
  const rowCount = Math.ceil(total / UNITS_PER_ROW);
  const perRow = Math.ceil(total / rowCount);
  const rows: RowItem[][] = [];
  let current: RowItem[] = [];
  let used = 0;
  for (const item of items) {
    const limit = rows.length === rowCount - 1 ? UNITS_PER_ROW : perRow;
    if (used + item.units > limit && current.length > 0) {
      rows.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += item.units;
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/**
 * O escritório com a sala do Friol no centro do universo: uma faixa central com o lazer, a sala
 * do Friol (no centro do canvas) e a Área de espera; as salas de projeto (acesas e apagadas, em
 * ordem estável) em fileiras centralizadas, metade acima e metade abaixo da faixa.
 * Sala com funcionários cadastrados + 1 > 2 ocupa 2 unidades (4 mesas); se passar de MAX_UNITS,
 * todas voltam a 1 unidade.
 */
export function buildOfficeLayout(
  rooms: LayoutRoom[],
  demand: LayoutDemand,
  decor: DecorationInput = NO_DECORATION,
): Layout {
  const wantsTwo = (room: LayoutRoom) => (demand.colsByRoom[room.id] ?? 1) > desksFor(1);
  const totalUnits = rooms.reduce((sum, room) => sum + (wantsTwo(room) ? 2 : 1), 0);
  const unitsOf = (room: LayoutRoom): 1 | 2 => (totalUnits <= MAX_UNITS && wantsTwo(room) ? 2 : 1);
  // Metade das unidades acima da faixa central e metade abaixo (ordem alfabética mantida).
  const items: RowItem[] = rooms.map((room) => ({ room, units: unitsOf(room) }));
  const half = Math.ceil(items.reduce((sum, item) => sum + item.units, 0) / 2);
  let acc = 0;
  const split = items.findIndex((item) => (acc += item.units) > half);
  const cut = split === -1 ? items.length : split;
  const aboveRows = packRows(items.slice(0, cut));
  const rows = [...aboveRows, ...packRows(items.slice(cut))];
  const aboveCount = aboveRows.length;

  // Faixa central: o centro da sala do Friol fica no centro do canvas.
  const bandTop = snapCell(CANVAS_H / 2 - LEISURE_H / 2);
  const bandBottom = bandTop + LEISURE_H;
  const friolX = snapCell(CANVAS_W / 2 - FRIOL_W / 2);

  const zones: Zone[] = [];
  const furniture: FurnitureItem[] = [];
  const seatsByRoom: Record<string, Spot[]> = {};
  const fiscalByRoom: Record<string, Spot> = {};

  rows.forEach((row, index) => {
    const rowWidth = row.reduce((sum, item) => sum + item.units * UNIT_STEP, 0) - CELL;
    const top =
      index < aboveCount
        ? bandTop - CORRIDOR - (aboveCount - index) * (ROOM_H + CORRIDOR) + CORRIDOR
        : bandBottom + CORRIDOR + (index - aboveCount) * (ROOM_H + CORRIDOR);
    let x = snapCell((CANVAS_W - rowWidth) / 2);
    for (const { room, units } of row) {
      const { w, h } = projectRoomSize(units);
      const zone: Zone = {
        id: room.id,
        kind: "project",
        label: room.label,
        x,
        y: top,
        w,
        h,
        lit: room.lit,
        accent: accentFor(room.id),
        door: { x: doorCenterX({ x, w }), y: top + h + CELL / 2 },
      };
      const make = itemFactory(room.id);
      zones.push(zone);
      furniture.push(...roomWalls(zone, "bottom", make));
      const need = Math.max(demand.seatsByRoom[room.id] ?? 0, 1);
      const contents = projectRoomContents(zone, desksFor(units), need, make);
      furniture.push(...contents.furniture);
      seatsByRoom[room.id] = contents.seats;
      fiscalByRoom[room.id] = contents.fiscal;
      x += w + CELL;
    }
  });

  // Faixa central: [Academia][Banheiros][Refeitório] [FRIOL] [Sala de descanso][Igreja][Área de espera]
  const label = (id: LeisureId) => LEISURE_ROOMS.find((room) => room.id === id)!.label;
  const waitingW = Math.max(LEISURE_W, (Math.ceil(Math.max(demand.population, 1) / WAITING_ROWS) + 2) * CELL);
  type BandSpec = { id: string; kind: Zone["kind"]; label: string | null; w: number; leisure?: LeisureId };
  const left: LeisureId[] = ["academia", "banheiros", "refeitorio"];
  const right: LeisureId[] = ["descanso", "igreja"];
  let leftX = friolX;
  const bandZones: Array<{ spec: BandSpec; x: number }> = [];
  for (const id of [...left].reverse()) {
    leftX -= CELL + LEISURE_W;
    bandZones.unshift({ spec: { id: `lazer:${id}`, kind: "leisure", label: label(id), w: LEISURE_W, leisure: id }, x: leftX });
  }
  bandZones.push({ spec: { id: "centro", kind: "center", label: null, w: FRIOL_W }, x: friolX });
  let rightX = friolX + FRIOL_W + CELL;
  for (const id of right) {
    bandZones.push({ spec: { id: `lazer:${id}`, kind: "leisure", label: label(id), w: LEISURE_W, leisure: id }, x: rightX });
    rightX += LEISURE_W + CELL;
  }
  bandZones.push({ spec: { id: "espera", kind: "waiting", label: "Área de espera", w: waitingW }, x: rightX });

  const leisure = {} as Record<LeisureId, Spot[]>;
  let center: ReturnType<typeof centerContents> | null = null;
  let centerDoor = { x: 0, y: 0 };
  let flags: Layout["flags"] = null;
  let waiting: Spot[] = [];
  for (const { spec, x } of bandZones) {
    const doorX = doorCenterX({ x, w: spec.w });
    const zone: Zone = {
      id: spec.id,
      kind: spec.kind,
      label: spec.label,
      x,
      y: bandTop,
      w: spec.w,
      h: LEISURE_H,
      lit: true,
      door: { x: doorX, y: bandTop - CELL / 2 },
    };
    const make = itemFactory(zone.id);
    zones.push(zone);
    furniture.push(...roomWalls(zone, "top", make));
    if (spec.kind === "center") {
      center = centerContents(zone, make);
      furniture.push(...center.furniture);
      centerDoor = zone.door;
      // Do lado de fora da porta, para quem olha a porta: Rússia à direita (oeste), Brasil à esquerda (leste).
      flags = {
        russia: { x: doorX - 3 * CELL, y: bandTop - CELL },
        brazil: { x: doorX + 3 * CELL, y: bandTop - CELL },
      };
    } else if (spec.kind === "waiting") {
      waiting = waitingContents(zone, Math.max(demand.population, 1));
    } else if (spec.leisure) {
      const contents = leisureContents(spec.leisure, zone, make);
      furniture.push(...contents.furniture);
      leisure[spec.leisure] = contents.spots;
    }
  }
  furniture.push(...decorationItems(zones, decor.decoration, { blockingZones: decor.blockingZones }));

  const c = center!;
  // A mesa grande do Friol é desenhada pelo ambiente da TV: entra só na navegação.
  const navFurniture = [...toNavFurniture(furniture), ...c.blockers];
  const parts = snapLayoutSpots(
    navFurniture,
    zones,
    {
      seatsByRoom,
      fiscalByRoom,
      leisure,
      center: {
        friol: c.friol,
        visits: c.visits,
        stand: c.stand,
        fiscal: c.fiscal,
        door: centerDoor,
        desk: c.desk,
        throne: c.throne,
        carpet: c.carpet,
      },
      waiting,
    },
    [centerDoor],
  );

  // Limites recortados ao conteúdo (a câmera enquadra só o que existe).
  const pad = 3 * CELL;
  return {
    furniture,
    navFurniture,
    bounds: {
      minX: Math.max(0, Math.min(...zones.map((z) => z.x)) - pad),
      minY: Math.max(0, Math.min(...zones.map((z) => z.y)) - pad),
      maxX: Math.min(CANVAS_W, Math.max(...zones.map((z) => z.x + z.w)) + pad),
      maxY: Math.min(CANVAS_H, Math.max(...zones.map((z) => z.y + z.h)) + pad),
    },
    zones,
    ...parts,
    flags,
  };
}
