import { WALL_THICKNESS } from "@/features/retro-office/core/constants";
import { getGymWorkoutLocations } from "@/features/retro-office/core/navigation";
import type { FurnitureItem } from "@/features/retro-office/core/types";
import { placeByVisualCenter } from "@/features/tv/layout/modelBounds";
import type { LeisureId, Spot, Zone } from "@/features/tv/layout/types";

/** Tudo é alinhado à grade de navegação (células de 25 px). */
export const CELL = 25;
export const DOOR_GAP = 4 * CELL;
// Mesa (4 células) + corredor (2 células): sempre há passagem entre as mesas.

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

/** Largura de uma unidade da grade de salas e o passo entre unidades. */
export const UNIT_W = 14 * CELL;
export const UNIT_STEP = UNIT_W + CELL;
export const ROOM_H = 8 * CELL;
const DESK_STEP = 4 * CELL;

/** Sala de projeto fechada com 1 ou 2 unidades de largura (3 ou 6 mesas). */
export const projectRoomSize = (units: 1 | 2) => ({
  w: units === 1 ? UNIT_W : UNIT_W + UNIT_STEP,
  h: ROOM_H,
});
export const desksFor = (units: 1 | 2) => (units === 1 ? 3 : 6);

// Paleta suave de identidade das salas (tapete): azuis, verdes e tons terrosos.
const ACCENTS = ["#7aa6c2", "#8fb996", "#c9a27e", "#a7a3c9", "#d4b483", "#86b3ad", "#c98f8f", "#9bb0c9"];
export const accentFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
};

/**
 * Postos de trabalho de uma sala de projeto, montados sobre onde os modelos 3D aparecem
 * (ver modelBounds.ts): a mesa fica nas fileiras 1–2, encostada na parede de cima; a cadeira
 * (virada para a mesa) logo abaixo, na fileira 3; a pessoa senta na cadeira olhando o monitor.
 * Fileiras: parede (0), mesas (1–2), cadeiras/lugares (3), passagem (4), em pé (5),
 * corredor até a porta (6), parede (7). Mesas a cada 4 colunas, com corredor entre elas.
 * Lotação = mesas + lugares de pé da fileira 5; quem passar disso vai para a Área de espera.
 */
export function projectRoomContents(
  zone: Zone,
  desks: number,
  seatsNeeded: number,
  make: (item: Item) => FurnitureItem,
): { furniture: FurnitureItem[]; seats: Spot[]; fiscal: Spot; capacity: number } {
  const top = zone.y;
  const furniture: FurnitureItem[] = [];
  const seats: Spot[] = [];
  for (let col = 0; col < desks; col += 1) {
    // +1 px: o desenho da mesa começa 0,8 px antes do canto; assim ocupa só 3 colunas.
    const dx = zone.x + 2 * CELL + col * DESK_STEP + 1;
    const seat: Spot = { x: dx + 30, y: top + 3 * CELL + CELL / 2, facing: Math.PI, pose: "sit" };
    furniture.push(
      make({ type: "desk_cubicle", x: dx, y: top + 62 }),
      make({ type: "computer", x: dx + 18, y: top + 48 }),
      make({ type: "keyboard", x: dx + 15, y: top + 49 }),
      make({ type: "mouse", x: dx + 47, y: top + 52 }),
      make({ type: "chair", ...placeByVisualCenter("chair", seat.x, seat.y, 180), facing: 180 }),
      make({ type: "trash", x: dx + 58, y: top + 70 }),
    );
    seats.push(seat);
  }
  // Decoração base (dicas de escritório): luz quente, planta no canto, relógio e armário na parede.
  const cols = zone.w / CELL;
  furniture.push(
    make({ type: "lamp", x: zone.x + CELL + 6, y: zone.y + 5 * CELL + 14 }),
    make({ type: "plant", x: zone.x + (cols - 2) * CELL + CELL / 2, y: zone.y + 5 * CELL + CELL / 2 }),
    make({ type: "clock", x: zone.x + Math.floor(cols / 2) * CELL, y: zone.y + 4 }),
  );
  if (desks > 3) furniture.push(make({ type: "wall_cabinet", x: zone.x + 2 * CELL, y: zone.y + 6 }));

  // Lugares de pé na fileira 5 (a planta ocupa o canto direito).
  const standCols = Math.max(0, cols - 6);
  const capacity = desks + standCols;
  for (let i = 0; seats.length < Math.min(seatsNeeded, capacity); i += 1) {
    seats.push({ ...cell(zone, 2 + i, 5), facing: Math.PI, pose: "stand" });
  }
  const fiscal: Spot = { ...cell(zone, 1, 4), facing: Math.PI / 2, pose: "stand" };
  return { furniture, seats, fiscal, capacity };
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
      // Mesa redonda no meio (o desenho dela tem 123×142 px) e uma cadeira de cada lado,
      // posicionadas pelo desenho; a pessoa senta na cadeira olhando para a mesa.
      const tableCenter = { x: x + zone.w / 2, y: y + 6 * CELL + CELL / 2 };
      const tablePos = placeByVisualCenter("round_table", tableCenter.x, tableCenter.y);
      const seatPoints = [
        { x: tableCenter.x, y: y + CELL + CELL / 2 },
        { x: tableCenter.x, y: y + 10 * CELL + CELL / 2 },
        { x: x + CELL + CELL / 2, y: tableCenter.y },
        { x: x + zone.w - CELL - CELL / 2, y: tableCenter.y },
      ];
      const chairs: Spot[] = seatPoints.map((p) => ({
        ...p,
        facing: lookAt(p.x, p.y, tableCenter.x, tableCenter.y),
        pose: "sit",
      }));
      const furniture = [
        make({ type: "round_table", ...tablePos }),
        ...chairs.map((p) => {
          const facing = Math.round((p.facing * 180) / Math.PI);
          return make({ type: "chair", ...placeByVisualCenter("chair", p.x, p.y, facing), facing });
        }),
        make({ type: "coffee_machine", ...at(8, 1) }),
      ];
      const counter: Spot[] = [
        { ...cell(zone, 7, 2), facing: Math.PI / 2, pose: "stand" },
        { ...cell(zone, 2, 2), facing: 0, pose: "stand" },
        { ...cell(zone, 7, 10), facing: Math.PI, pose: "stand" },
        { ...cell(zone, 2, 10), facing: Math.PI, pose: "stand" },
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

/** Sala do Friol (centro): mesa grande no meio, visitas, lugares de pé e do Fiscal. Porta no topo. */
export function centerContents(zone: Zone, make: (item: Item) => FurnitureItem) {
  const cols = Math.round(zone.w / CELL);
  const mid = Math.floor(cols / 2);
  // Mesa grande no meio; corredor livre na coluna 1 até a cadeira do Friol, atrás da mesa.
  const furniture = [
    make({ type: "executive_desk", x: zone.x + zone.w / 2 - 65, y: zone.y + 5 * CELL }),
    make({ type: "lamp", x: zone.x + (cols - 2) * CELL + 2, y: zone.y + 10 * CELL }),
  ];
  const friol: Spot = { ...cell(zone, mid, 9), facing: Math.PI, pose: "sit" };
  const visits: Spot[] = [mid - 2, mid - 1, mid + 1, mid + 2].map((c) => ({ ...cell(zone, c, 3), facing: 0, pose: "stand" }));
  const stand: Spot[] = [2, 3, 4, 5, 6, 7].map((r) => ({ ...cell(zone, 1, r), facing: Math.PI / 2, pose: "stand" }));
  const fiscal: Spot = { ...cell(zone, cols - 2, 2), facing: -Math.PI / 2, pose: "stand" };
  return { furniture, friol, visits, stand, fiscal };
}

/** Lugares da Área de espera: uma célula por pessoa, em fileiras (porta no topo). */
export function waitingContents(zone: Zone, count: number): Spot[] {
  const cols = Math.round(zone.w / CELL) - 2;
  const rows = Math.round(zone.h / CELL) - 3;
  const spots: Spot[] = [];
  for (let i = 0; i < Math.min(count, cols * rows); i += 1) {
    spots.push({ ...cell(zone, 1 + (i % cols), 2 + Math.floor(i / cols)), facing: 0, pose: "stand" });
  }
  return spots;
}
