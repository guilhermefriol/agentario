import { SCALE } from "@/features/retro-office/core/constants";
import { DISTRICT_CAMERA_POSITION, DISTRICT_CAMERA_TARGET } from "@/features/retro-office/core/district";
import type { Layout } from "@/features/tv/layout/types";

type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

/**
 * Enquadra o layout na tela: alvo no centro dos limites e zoom ortográfico que faz os
 * quatro cantos (projetados na direção isométrica da cena) caberem com uma margem.
 */
export function fitCamera(
  bounds: Layout["bounds"],
  viewport: { width: number; height: number },
  margin = 1.08,
): { x: number; y: number; zoom: number } {
  const forward = normalize(sub(DISTRICT_CAMERA_TARGET, DISTRICT_CAMERA_POSITION));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const width = (bounds.maxX - bounds.minX) * SCALE;
  const depth = (bounds.maxY - bounds.minY) * SCALE;
  let spanRight = 0;
  let spanUp = 0;
  for (const sx of [-0.5, 0.5]) {
    for (const sz of [-0.5, 0.5]) {
      const corner: Vec3 = [sx * width, 0, sz * depth];
      spanRight = Math.max(spanRight, Math.abs(dot(corner, right)) * 2);
      spanUp = Math.max(spanUp, Math.abs(dot(corner, up)) * 2);
    }
  }
  // Espaço para cabeçalho (topo) e faixa inferior.
  const usableHeight = Math.max(viewport.height - 150, 200);
  const zoom = Math.min(viewport.width / (spanRight * margin), usableHeight / (spanUp * margin));
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    zoom: Math.max(8, Math.min(zoom, 120)),
  };
}

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Está no horário do modo noite? Aceita intervalo que cruza a meia-noite. */
export function isNight(night: { enabled: boolean; from: string; to: string }, date: Date): boolean {
  if (!night.enabled) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(night.from);
  const to = minutesOf(night.to);
  return from <= to ? now >= from && now < to : now >= from || now < to;
}
