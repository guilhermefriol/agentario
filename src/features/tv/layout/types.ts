import type { AgentDirectedPose, FurnitureItem } from "@/features/retro-office/core/types";

export type Spot = {
  x: number;
  y: number;
  facing: number;
  pose: AgentDirectedPose;
  workoutStyle?: "run" | "lift" | "bike" | "box" | "row" | "stretch";
};

export type ZoneKind = "project" | "center" | "leisure" | "waiting";

/** Retângulo no canvas (px) que vira piso, placa e paredes da sala. */
export type Zone = {
  id: string;
  kind: ZoneKind;
  label: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  lit: boolean;
  /** Cor de identidade da sala (tapete), escolhida pelo id. */
  accent?: string;
  /** Ponto logo do lado de fora da porta (por onde se entra). */
  door: { x: number; y: number };
};

export type LeisureId = "academia" | "banheiros" | "refeitorio" | "descanso" | "igreja";

/** O escritório: um andar com todas as salas de projeto, a sala do Friol e o lazer. */
export type Layout = {
  /** O que a cena desenha. */
  furniture: FurnitureItem[];
  /** O que bloqueia passagem: cada móvel sobre o retângulo em que aparece (ver modelBounds.ts). */
  navFurniture: FurnitureItem[];
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
  flags: { russia: { x: number; y: number }; brazil: { x: number; y: number } } | null;
};

export type LayoutRoom = { id: string; label: string; lit: boolean };

/**
 * Demanda de lugares. `colsByRoom` (mesas) é estável — vem dos funcionários cadastrados — para a
 * planta não mudar quando sessões entram e saem; `seatsByRoom` é quantas pessoas estão na sala agora.
 */
export type LayoutDemand = {
  seatsByRoom: Record<string, number>;
  colsByRoom: Record<string, number>;
  population: number;
};
