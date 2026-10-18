import type { AgentDirectedPose, FurnitureItem } from "@/features/retro-office/core/types";

export type LayoutKind = "acesas" | "baias" | "andares";

export const LAYOUT_KINDS: readonly LayoutKind[] = ["acesas", "baias", "andares"];

export type Spot = {
  x: number;
  y: number;
  facing: number;
  pose: AgentDirectedPose;
  workoutStyle?: "run" | "lift" | "bike" | "box" | "row" | "stretch";
  /** Andar (layout "andares"); ausente nos outros. */
  floor?: number;
};

export type ZoneKind = "project" | "center" | "leisure";

/** Retângulo no canvas (px) que vira piso, placa e, se for sala fechada, paredes. */
export type Zone = {
  id: string;
  kind: ZoneKind;
  label: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  lit: boolean;
  /** Baia aberta (sem paredes) — layout "baias". */
  open: boolean;
  /** Andar onde a zona está (layout "andares"); 0 nos outros. */
  floor: number;
  /** Ponto logo do lado de fora da porta (por onde se entra). */
  door: { x: number; y: number };
};

export type LeisureId = "academia" | "banheiros" | "refeitorio" | "descanso" | "igreja";

export type Layout = {
  kind: LayoutKind;
  furniture: FurnitureItem[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  zones: Zone[];
  /** Lugares de trabalho por sala de projeto (id da sala do adaptador). */
  seatsByRoom: Record<string, Spot[]>;
  /** Lugar de pé do Fiscal por sala. */
  fiscalByRoom: Record<string, Spot>;
  leisure: Record<LeisureId, Spot[]>;
  center: { friol: Spot; visits: Spot[]; stand: Spot[]; fiscal: Spot; door: { x: number; y: number } };
  /** Área de espera: um lugar distinto por pessoa que possa precisar. */
  waiting: Spot[];
  /** Salas apagadas que não aparecem na cena (layout "acesas"). */
  hiddenRooms: string[];
  flags: { russia: { x: number; y: number }; brazil: { x: number; y: number } } | null;
  floors: number;
  /** Plantas por andar (layout "andares"); o terraço é a última. A cena mostra uma por vez. */
  floorPlans: FloorPlan[];
};

export type FloorPlan = {
  floor: number;
  label: string;
  furniture: FurnitureItem[];
  zones: Zone[];
  bounds: Layout["bounds"];
  /** Ponto do elevador no corredor do andar (mesmas coordenadas em todos os andares). */
  elevator: { x: number; y: number };
};

export type LayoutRoom = { id: string; label: string; lit: boolean };

/** Demanda de lugares: quantas pessoas cada sala precisa sentar e quantas podem ir para a espera. */
export type LayoutDemand = { seatsByRoom: Record<string, number>; population: number };
