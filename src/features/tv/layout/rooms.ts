import { WALL_THICKNESS } from "@/features/retro-office/core/constants";
import { getGymWorkoutLocations } from "@/features/retro-office/core/navigation";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import type { LeisureId, Spot, Zone } from "@/features/tv/layout/types";

/** Tudo é alinhado à grade de navegação (células de 25 px). */
export const CELL = 25;
export const DOOR_GAP = 4 * CELL;
export const DESK_W = 100;
// Mesa (4 células) + corredor (2 células): sempre há passagem entre as mesas.
const DESK_STEP_X = 6 * CELL;

export const LEISURE_W = 10 * CELL;
export const LEISURE_H = 12 * CELL;

export const LEISURE_ROOMS: ReadonlyArray<{ id: LeisureId; label: string }> = [
  { id: "academia", label: "Academia" },
  { id: "banheiros", label: "Banheiros" },
  { id: "refeitorio", label: "Refeitório" },
  { id: "descanso", label: "Sala de descanso" },
  { id: "igreja", label: "Igreja Adventista da I.A. dos Últimos Dias" },
];

type Item = Omit<FurnitureItem, "_uid">;

/** Centro da célula (c, r) de uma zona. */
const cell = (zone: Pick<Zone, "x" | "y">, c: number, r: number) => ({
  x: zone.x + c * CELL + CELL / 2,
  y: zone.y + r * CELL + CELL / 2,
});

/** Fábrica de itens com `_uid` determinístico por zona. */
export const itemFactory = (zoneId: string) => {
  let n = 0;
  return (item: Item): FurnitureItem => ({ ...item, _uid: `ag:${zoneId}:${(n += 1)}` });
};

/** Paredes de uma sala fechada com vão de porta (alinhado à grade) no lado indicado. */
export function roomWalls(
  zone: Pick<Zone, "id" | "x" | "y" | "w" | "h">,
  doorSide: "top" | "bottom",
  make: (item: Item) => FurnitureItem,
): FurnitureItem[] {
  const { x, y, w, h } = zone;
  const t = WALL_THICKNESS;
  const gapStart = x + Math.floor((w / 2 - DOOR_GAP / 2) / CELL) * CELL;
  const gapEnd = gapStart + DOOR_GAP;
  const horizontal = (wy: number, withDoor: boolean) =>
    withDoor
      ? [
          make({ type: "wall", x, y: wy, w: gapStart - x, h: t }),
          make({ type: "wall", x: gapEnd, y: wy, w: x + w - gapEnd, h: t }),
        ]
      : [make({ type: "wall", x, y: wy, w, h: t })];
  return [
    ...horizontal(y, doorSide === "top"),
    ...horizontal(y + h - t, doorSide === "bottom"),
    make({ type: "wall", x, y, w: t, h }),
    make({ type: "wall", x: x + w - t, y, w: t, h }),
  ];
}

/** Centro do vão da porta (para posicionar a entrada). */
export const doorCenterX = (zone: Pick<Zone, "x" | "w">) =>
  zone.x + Math.floor((zone.w / 2 - DOOR_GAP / 2) / CELL) * CELL + DOOR_GAP / 2;

/**
 * Sala de projeto com uma fileira de `cols` mesas. Fechada (paredes) ou baia aberta,
 * que é mais baixa por não precisar da folga das paredes.
 */
export const projectRoomSize = (cols: number, open: boolean) => ({
  w: 2 * CELL + cols * DESK_STEP_X,
  h: open ? 4 * CELL : 8 * CELL,
});

/**
 * Mesas e lugares de uma sala de projeto. Cada lugar fica na célula logo acima da mesa,
 * olhando para ela; quem passar do número de mesas fica de pé na fileira de cima.
 */
export function projectRoomContents(
  zone: Zone,
  cols: number,
  seatsNeeded: number,
  make: (item: Item) => FurnitureItem,
): { furniture: FurnitureItem[]; seats: Spot[]; fiscal: Spot } {
  // Fechada: parede (0), lugares (1–2), mesas (3–5), corredor até a porta (6), parede (7).
  // Baia aberta: lugares (0), mesas (1–3).
  const deskRow = zone.open ? 1 : 3;
  const furniture: FurnitureItem[] = [];
  const seats: Spot[] = [];
  for (let col = 0; col < cols; col += 1) {
    const dx = zone.x + 2 * CELL + col * DESK_STEP_X;
    furniture.push(make({ type: "desk_cubicle", x: dx, y: zone.y + deskRow * CELL }));
    seats.push({ ...cell(zone, 4 + col * 6, deskRow - 1), facing: 0, pose: "sit" });
  }
  const standRow = deskRow - 2;
  const standCols = Math.max(1, zone.w / CELL - 2);
  for (let extra = seats.length; extra < seatsNeeded; extra += 1) {
    const i = extra - cols;
    seats.push({
      ...cell(zone, 1 + (i % standCols), Math.max(zone.open ? 0 : 1, standRow - Math.floor(i / standCols))),
      facing: 0,
      pose: "stand",
    });
  }
  const fiscal: Spot = { ...cell(zone, zone.w / CELL - 2, zone.open ? 0 : 1), facing: 0, pose: "stand" };
  return { furniture, seats, fiscal };
}

/** Facing para olhar de (x,y) até (tx,ty), no padrão da cena (atan2(dx, dy)). */
const lookAt = (x: number, y: number, tx: number, ty: number) => Math.atan2(tx - x, ty - y);

/**
 * Móveis e lugares de cada sala de lazer (porta no topo; 10 × 12 células). A entrada
 * (fileiras 1–2 sob a porta) fica livre e sempre sobra uma coluna de passagem.
 */
export function leisureContents(
  id: LeisureId,
  zone: Zone,
  make: (item: Item) => FurnitureItem,
): { furniture: FurnitureItem[]; spots: Spot[] } {
  const { x, y } = zone;
  const at = (c: number, r: number) => ({ x: x + c * CELL, y: y + r * CELL });
  switch (id) {
    case "academia": {
      const furniture = [
        make({ type: "treadmill", ...at(1, 4), facing: 0 }),
        make({ type: "exercise_bike", ...at(7, 4), facing: 0 }),
        make({ type: "weight_bench", ...at(1, 9), facing: 0 }),
        make({ type: "punching_bag", ...at(8, 9) }),
      ];
      const spots = getGymWorkoutLocations(furniture).map(
        (location): Spot => ({
          x: location.x,
          y: location.y,
          facing: location.facing,
          pose: "workout",
          workoutStyle: location.workoutStyle,
        }),
      );
      spots.push(
        { ...cell(zone, 5, 3), facing: 0, pose: "workout", workoutStyle: "stretch" },
        { ...cell(zone, 6, 8), facing: 0, pose: "workout", workoutStyle: "stretch" },
      );
      return { furniture, spots };
    }
    case "refeitorio": {
      const table = at(3, 4);
      const center = { x: table.x + 60, y: table.y + 60 };
      const chairs: Spot[] = [cell(zone, 5, 2), cell(zone, 5, 10), cell(zone, 1, 6), cell(zone, 3, 10)].map(
        (p) => ({ ...p, facing: lookAt(p.x, p.y, center.x, center.y), pose: "sit" }),
      );
      const furniture = [
        make({ type: "round_table", ...table }),
        ...chairs.map((p) => make({ type: "chair", x: p.x - 12, y: p.y - 12, facing: 0 })),
        make({ type: "coffee_machine", ...at(8, 1) }),
      ];
      const counter: Spot[] = [
        { ...cell(zone, 7, 2), facing: Math.PI / 2, pose: "stand" },
        { ...cell(zone, 2, 2), facing: 0, pose: "stand" },
        { ...cell(zone, 7, 10), facing: Math.PI, pose: "stand" },
        { ...cell(zone, 1, 9), facing: Math.PI, pose: "stand" },
      ];
      return { furniture, spots: [...chairs, ...counter] };
    }
    case "descanso": {
      const furniture = [
        make({ type: "couch_v", ...at(1, 3) }),
        make({ type: "couch_v", ...at(8, 3) }),
        make({ type: "beanbag", ...at(2, 8) }),
        make({ type: "beanbag", ...at(7, 8) }),
      ];
      const spots: Spot[] = [
        { ...cell(zone, 4, 4), facing: -Math.PI / 2, pose: "sit" },
        { ...cell(zone, 4, 6), facing: -Math.PI / 2, pose: "sit" },
        { ...cell(zone, 6, 4), facing: Math.PI / 2, pose: "sit" },
        { ...cell(zone, 6, 6), facing: Math.PI / 2, pose: "sit" },
        { ...cell(zone, 5, 7), facing: Math.PI, pose: "sit" },
        { ...cell(zone, 5, 9), facing: Math.PI, pose: "stand" },
        { ...cell(zone, 5, 3), facing: 0, pose: "stand" },
      ];
      return { furniture, spots };
    }
    case "banheiros": {
      const furniture = [2, 5, 8].map((r) => make({ type: "sink", ...at(1, r) }));
      const sinks: Spot[] = [2, 5, 8].map((r) => ({ ...cell(zone, 4, r), facing: -Math.PI / 2, pose: "stand" }));
      // Cabines desenhadas pelo ambiente da TV, na coluna 8; cada uma tem um lugar de pé.
      const stalls: Spot[] = [2, 4, 6, 8].map((r) => ({ ...cell(zone, 8, r), facing: Math.PI / 2, pose: "stand" }));
      return { furniture, spots: [...sinks, ...stalls] };
    }
    case "igreja": {
      // Bancos e altar são desenhados pelo ambiente da TV; aqui só os lugares, olhando para o altar (sul).
      const spots: Spot[] = [];
      for (const r of [3, 5, 7, 9]) {
        for (const c of [1, 3, 6, 8]) spots.push({ ...cell(zone, c, r), facing: 0, pose: "sit" });
      }
      return { furniture: [], spots };
    }
  }
}

/** Sala do Friol (centro, 10 × 12 células): mesa grande, visitas, lugares de pé e do Fiscal. Porta no topo. */
export function centerContents(zone: Zone, make: (item: Item) => FurnitureItem) {
  // Mesa grande no meio; corredor livre na coluna 1 até a cadeira do Friol, atrás da mesa.
  const furniture = [make({ type: "executive_desk", x: zone.x + 3 * CELL - 2, y: zone.y + 5 * CELL })];
  const friol: Spot = { ...cell(zone, 5, 9), facing: Math.PI, pose: "sit" };
  const visits: Spot[] = [3, 4, 6, 7].map((c) => ({ ...cell(zone, c, 3), facing: 0, pose: "stand" }));
  const stand: Spot[] = [2, 3, 4, 5, 6, 7].map((r) => ({ ...cell(zone, 1, r), facing: Math.PI / 2, pose: "stand" }));
  const fiscal: Spot = { ...cell(zone, 8, 2), facing: -Math.PI / 2, pose: "stand" };
  return { furniture, friol, visits, stand, fiscal };
}
