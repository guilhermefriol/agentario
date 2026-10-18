import type { FurnitureItem } from "@/features/retro-office/core/types";
import {
  CANVAS,
  GAP,
  MARGIN,
  bottomRow,
  snapLayoutSpots,
  waitingSpots,
} from "@/features/tv/layout/build";
import {
  CELL,
  doorCenterX,
  itemFactory,
  projectRoomContents,
  projectRoomSize,
  roomWalls,
} from "@/features/tv/layout/rooms";
import type {
  FloorPlan,
  Layout,
  LayoutDemand,
  LayoutRoom,
  LeisureId,
  Spot,
  Zone,
} from "@/features/tv/layout/types";

const ROWS_PER_FLOOR = 2;
const CORRIDOR = 3 * CELL;
const ELEVATOR = { x: CANVAS - MARGIN - CELL / 2, dy: CELL + CELL / 2 };

const withFloor = (spots: Spot[], floor: number) => spots.map((spot) => ({ ...spot, floor }));

/**
 * Prédio com andares. Cada andar é uma planta própria (mesmas coordenadas), e a tela mostra
 * uma por vez; só se troca de andar pelo elevador. Andares de projeto têm até duas fileiras
 * de salas com corredor; o terraço (andar mais alto) tem a sala do Friol, o lazer e a espera.
 */
export function buildFloorsLayout(rooms: LayoutRoom[], demand: LayoutDemand): Layout {
  const usable = CANVAS - 2 * MARGIN;
  const plans: FloorPlan[] = [];
  const seatsByRoom: Record<string, Spot[]> = {};
  const fiscalByRoom: Record<string, Spot> = {};

  // Distribui as salas em fileiras que cabem na largura e as fileiras em andares.
  const items = rooms.map((room) => {
    const need = Math.max(demand.seatsByRoom[room.id] ?? 0, 1);
    const cols = Math.min(Math.max(need, 1), 3);
    return { room, need, cols, size: projectRoomSize(cols, false) };
  });
  const rows: (typeof items)[] = [];
  let current: typeof items = [];
  let width = 0;
  for (const item of items) {
    if (current.length > 0 && width + GAP + item.size.w > usable) {
      rows.push(current);
      current = [];
      width = 0;
    }
    width += (current.length > 0 ? GAP : 0) + item.size.w;
    current.push(item);
  }
  if (current.length > 0) rows.push(current);
  const floorRows: (typeof items)[][] = [];
  for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_FLOOR) floorRows.push(rows.slice(i, i + ROWS_PER_FLOOR));

  floorRows.forEach((rowsOfFloor, index) => {
    const floor = index + 1;
    const zones: Zone[] = [];
    const furniture: FurnitureItem[] = [];
    const floorSeats: Record<string, Spot[]> = {};
    const floorFiscal: Record<string, Spot> = {};
    let top = MARGIN;
    let elevatorY = MARGIN;
    rowsOfFloor.forEach((row, rowIndex) => {
      let x = MARGIN;
      const rowH = Math.max(...row.map((item) => item.size.h));
      for (const item of row) {
        const zone: Zone = {
          id: item.room.id,
          kind: "project",
          label: item.room.label,
          x,
          y: top,
          w: item.size.w,
          h: item.size.h,
          lit: item.room.lit,
          open: false,
          floor,
          door: { x: doorCenterX({ x, w: item.size.w }), y: top + item.size.h + CELL / 2 },
        };
        const make = itemFactory(item.room.id);
        zones.push(zone);
        furniture.push(...roomWalls(zone, "bottom", make));
        const contents = projectRoomContents(zone, item.cols, item.need, make);
        furniture.push(...contents.furniture);
        floorSeats[item.room.id] = contents.seats;
        floorFiscal[item.room.id] = contents.fiscal;
        x += item.size.w + GAP;
      }
      if (rowIndex === 0) elevatorY = top + rowH + ELEVATOR.dy;
      top += rowH + CORRIDOR;
    });
    const elevator = { x: ELEVATOR.x, y: elevatorY };
    const snapped = snapLayoutSpots(
      furniture,
      zones,
      {
        seatsByRoom: floorSeats,
        fiscalByRoom: floorFiscal,
        leisure: {} as Record<LeisureId, Spot[]>,
        center: { friol: elevator as Spot, visits: [], stand: [], fiscal: elevator as Spot, door: elevator },
        waiting: [],
      },
      [elevator],
    );
    for (const [id, spots] of Object.entries(snapped.seatsByRoom)) seatsByRoom[id] = withFloor(spots, floor);
    for (const [id, spot] of Object.entries(snapped.fiscalByRoom)) fiscalByRoom[id] = { ...spot, floor };
    plans.push({
      floor,
      label: `${floor}º andar`,
      furniture,
      zones,
      bounds: { minX: 0, minY: 0, maxX: CANVAS, maxY: Math.min(CANVAS, top + MARGIN) },
      elevator,
    });
  });

  // Terraço: corredor com a espera (elevador na ponta) e a fileira do Friol + lazer.
  const terraceFloor = plans.length + 1;
  const waiting = waitingSpots(Math.max(demand.population, 1), MARGIN + CELL);
  const terrace = bottomRow(waiting.bottom + 2 * CELL);
  const terraceZones = terrace.zones.map((zone) => ({ ...zone, floor: terraceFloor }));
  const elevator = { x: ELEVATOR.x, y: MARGIN + CELL + CELL / 2 };
  const parts = snapLayoutSpots(
    terrace.furniture,
    terraceZones,
    { seatsByRoom: {}, fiscalByRoom: {}, leisure: terrace.leisure, center: terrace.center, waiting: waiting.spots },
    [terrace.center.door, elevator],
  );
  plans.push({
    floor: terraceFloor,
    label: "Terraço",
    furniture: terrace.furniture,
    zones: terraceZones,
    bounds: { minX: 0, minY: 0, maxX: CANVAS, maxY: terrace.bottom + MARGIN },
    elevator,
  });

  const leisure = {} as Record<LeisureId, Spot[]>;
  for (const [id, spots] of Object.entries(parts.leisure)) leisure[id as LeisureId] = withFloor(spots, terraceFloor);
  const center = parts.center;
  return {
    kind: "andares",
    furniture: [],
    bounds: plans[plans.length - 1].bounds,
    zones: plans.flatMap((plan) => plan.zones),
    seatsByRoom,
    fiscalByRoom,
    leisure,
    center: {
      friol: { ...center.friol, floor: terraceFloor },
      fiscal: { ...center.fiscal, floor: terraceFloor },
      visits: withFloor(center.visits, terraceFloor),
      stand: withFloor(center.stand, terraceFloor),
      door: center.door,
    },
    waiting: withFloor(parts.waiting, terraceFloor),
    hiddenRooms: [],
    flags: terrace.flags,
    floors: terraceFloor,
    floorPlans: plans,
  };
}
