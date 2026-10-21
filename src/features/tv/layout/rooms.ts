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
  { id: "espirita", label: "Casa Espírita" },
  { id: "terreiro", label: "Terreiro de Umbanda" },
];

/** Colunas da gira no Terreiro; depois delas vem a ala de transbordo, que cresce com a população. */
export const TERREIRO_GIRA_COLS = 10;
/** Fileiras de pé da ala de transbordo (3 a 10: a entrada sob a porta fica livre). */
export const OVERFLOW_ROWS = 8;

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
 * Lotação = mesas + lugares de pé da fileira 5; quem passar disso vai para a ala de transbordo do Terreiro.
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
 * `blockers` são peças desenhadas pelo ambiente da TV que entram só na navegação.
 */
export function leisureContents(
  id: LeisureId,
  zone: Zone,
  make: (item: Item) => FurnitureItem,
): { furniture: FurnitureItem[]; spots: Spot[]; blockers?: FurnitureItem[] } {
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
      // Mesa redonda no meio e uma cadeira de cada lado, posicionadas pelo desenho;
      // a pessoa senta na cadeira olhando para a mesa.
      // A mesa redonda é uma forma própria da cena, desenhada dentro do seu espaço (120×120).
      const tableCenter = { x: x + zone.w / 2, y: y + 6 * CELL + CELL / 2 };
      const tablePos = { x: tableCenter.x - 60, y: tableCenter.y - 60 };
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
    case "espirita": {
      // Plateia sentada olhando para a mesa de palestra (sul); duas pessoas de pé atrás da mesa.
      const { table } = espiritaPieces(zone);
      const seats: Spot[] = [];
      for (const r of [3, 5]) {
        for (const c of [2, 3, 6, 7]) seats.push({ ...cell(zone, c, r), facing: 0, pose: "sit" });
      }
      const furniture = [
        ...seats.map((p) => make({ type: "chair", ...placeByVisualCenter("chair", p.x, p.y, 0), facing: 0 })),
        make({ type: "bookshelf", ...placeByVisualCenter("bookshelf", cell(zone, 8, 10).x, cell(zone, 8, 10).y) }),
      ];
      const speakers: Spot[] = [3, 6].map((c) => ({ ...cell(zone, c, 10), facing: Math.PI, pose: "stand" }));
      // A mesa bloqueia só as células 2–7 das fileiras 8–9 (a folga da navegação fica dentro delas).
      const pad = 16;
      const blockers = [
        make({ type: "wall", x: table.x + pad, y: table.y + pad, w: table.w - 2 * pad, h: table.h - 2 * pad }),
      ];
      return { furniture, spots: [...seats, ...speakers], blockers };
    }
    case "terreiro": {
      // A gira: roda de pé em volta do centro, todos olhando para o meio; os ogãs tocam os
      // atabaques no canto sul, de frente para eles.
      const { giraCenter, atabaques } = terreiroPieces(zone);
      const ring: Array<[number, number]> = [[0, -3], [2, -2], [3, 0], [2, 2], [0, 3], [-2, 2], [-3, 0], [-2, -2]];
      const gira: Spot[] = ring.map(([dc, dr]) => {
        const p = cell(zone, 5 + dc, 6 + dr);
        return { ...p, facing: lookAt(p.x, p.y, giraCenter.x, giraCenter.y), pose: "stand" };
      });
      const ogas: Spot[] = atabaques.map((drum) => ({ x: drum.x, y: drum.y - CELL, facing: 0, pose: "stand" }));
      return { furniture: [], spots: [...gira, ...ogas] };
    }
  }
}

/** Peças da Casa Espírita desenhadas pelo ambiente da TV (mesa de palestra ao sul). */
export function espiritaPieces(zone: Pick<Zone, "x" | "y">) {
  return { table: { x: zone.x + 2 * CELL, y: zone.y + 8 * CELL, w: 6 * CELL, h: 2 * CELL } };
}

/** Peças do Terreiro desenhadas pelo ambiente da TV: congá na parede oeste e três atabaques. */
export function terreiroPieces(zone: Pick<Zone, "x" | "y">) {
  return {
    giraCenter: cell(zone, 5, 6),
    conga: { x: zone.x + WALL_THICKNESS, y: zone.y + 4 * CELL, w: CELL - WALL_THICKNESS, h: 5 * CELL },
    atabaques: [1, 2, 3].map((c) => cell(zone, c, 10)),
  };
}

/**
 * Sala do Friol (centro), porta embaixo (sul): tapete vermelho da porta até a mesa grande; atrás
 * dela, ao norte, o trono onde o Friol senta de frente para quem chega (e para a câmera da TV).
 * Mesa, trono e tapete são desenhados pelo ambiente da TV; a mesa entra na navegação (`blockers`).
 */
export function centerContents(zone: Zone, make: (item: Item) => FurnitureItem) {
  const cols = Math.round(zone.w / CELL);
  const cx = zone.x + zone.w / 2;
  const desk = { x: cx - 4 * CELL, y: zone.y + 4 * CELL, w: 8 * CELL, h: 40 };
  const throne = { x: cx, y: zone.y + 2 * CELL + CELL / 2 };
  const carpetTop = desk.y + desk.h;
  const carpet = { x: cx - 40, y: carpetTop, w: 80, h: zone.y + zone.h - 4 - carpetTop };
  const furniture = [
    make({ type: "lamp", ...placeByVisualCenter("lamp", cx - 3 * CELL, throne.y) }),
    make({ type: "lamp", ...placeByVisualCenter("lamp", cx + 3 * CELL, throne.y) }),
  ];
  const blockers = [make({ type: "wall", x: desk.x, y: desk.y, w: desk.w, h: desk.h })];
  const friol: Spot = { ...throne, facing: 0, pose: "sit" };
  // Visitas de pé no tapete, de frente para o Friol (olhando para o norte).
  const visits: Spot[] = [-1.5, -0.5, 0.5, 1.5].map((k) => ({
    x: cx + k * CELL,
    y: zone.y + 7 * CELL + CELL / 2,
    facing: Math.PI,
    pose: "stand",
  }));
  const stand: Spot[] = [4, 5, 6, 7, 8, 9].map((r) => ({ ...cell(zone, 1, r), facing: Math.PI / 2, pose: "stand" }));
  const fiscal: Spot = { ...cell(zone, cols - 2, 9), facing: -Math.PI / 2, pose: "stand" };
  return { furniture, blockers, friol, visits, stand, fiscal, desk, throne, carpet };
}

/**
 * Ala de transbordo do Terreiro: depois das colunas da gira, uma célula de pé por pessoa, em
 * colunas de `OVERFLOW_ROWS` (a última coluna da sala é parede).
 */
export function overflowContents(zone: Zone, count: number): Spot[] {
  const cols = Math.round(zone.w / CELL) - TERREIRO_GIRA_COLS - 1;
  const spots: Spot[] = [];
  for (let i = 0; i < Math.min(count, cols * OVERFLOW_ROWS); i += 1) {
    const c = TERREIRO_GIRA_COLS + Math.floor(i / OVERFLOW_ROWS);
    spots.push({ ...cell(zone, c, 3 + (i % OVERFLOW_ROWS)), facing: 0, pose: "stand" });
  }
  return spots;
}
