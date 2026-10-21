import {
  ITEM_METADATA,
  getItemBaseSize,
  getItemRotationRadians,
} from "@/features/retro-office/core/geometry";
import type { FurnitureItem } from "@/features/retro-office/core/types";

/**
 * Limites desenhados de cada modelo 3D .glb (px do canvas, sem rotação, relativos ao canto do
 * item). Tipos desenhados por formas próprias da cena (mesa redonda, teclado, academia, pia...)
 * ficam dentro do próprio espaço e não entram aqui:
 * [minX, maxX, minY, maxY]. Gerados a partir dos arquivos .glb (árvore de nós + escala da cena).
 * Os modelos são desenhados ao norte do ponto de origem, enquanto o espaço de navegação padrão
 * fica ao sul — por isso a TV usa estes limites para bloquear exatamente onde o móvel aparece.
 */
export const MODEL_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  desk_cubicle: [-0.8, 60.4, -31.7, 1],
  executive_desk: [0, 97.4, -97.4, 0],
  chair: [0, 22.3, -21, 0],
  couch: [0, 98, -41, 0],
  couch_v: [0, 56.7, -31.9, 0],
  bookshelf: [0, 33.3, -20.8, 0],
  plant: [-7.1, 7.1, -8, 8],
  beanbag: [0, 40.5, -22.8, 0],
  table_rect: [0, 65.4, -24.9, 0],
  coffee_machine: [0, 8.4, -10.7, 0],
  fridge: [0, 23.9, -15.7, 0.6],
  water_cooler: [-2.6, 2.6, -2.6, 2.6],
  whiteboard: [0, 13.3, -4.2, 0],
  cabinet: [0, 62.1, -25, 0],
  computer: [0, 24, -6.4, 0],
  lamp: [-1.1, 9.1, -9.9, 1.9],
};

export type Rect = { x: number; y: number; w: number; h: number };

/** Retângulo onde o item aparece na cena (com rotação em torno do centro do seu espaço). */
export function visualRect(item: FurnitureItem): Rect | null {
  const bounds = MODEL_BOUNDS[item.type];
  if (!bounds) return null;
  const [minX, maxX, minY, maxY] = bounds;
  const { width, height } = getItemBaseSize(item);
  const pw = width / 2;
  const ph = height / 2;
  const angle = getItemRotationRadians(item);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const px of [minX, maxX]) {
    for (const py of [minY, maxY]) {
      // Mesma rotação da cena (Matrix4.makeRotationY) em torno do pivô (centro do espaço).
      const dx = px - pw;
      const dy = py - ph;
      xs.push(item.x + pw + dx * cos + dy * sin);
      ys.push(item.y + ph - dx * sin + dy * cos);
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Lista de navegação: cada item que bloqueia passagem e tem modelo 3D vira um bloqueio sobre o
 * retângulo desenhado (mesa sem folga, como no original; os demais com a folga padrão).
 */
export function toNavFurniture(furniture: FurnitureItem[]): FurnitureItem[] {
  return furniture.map((item) => {
    if (!ITEM_METADATA[item.type]?.blocksNavigation) return item;
    const rect = visualRect(item);
    if (!rect) return item;
    return {
      _uid: `${item._uid}:nav`,
      type: item.type === "desk_cubicle" ? "desk_cubicle" : "wall",
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
    };
  });
}

/**
 * Posição do item para que o centro do seu desenho caia em (cx, cy). Para cadeiras, `facing`
 * (graus) é a direção em que a pessoa sentada olha.
 */
export function placeByVisualCenter(type: string, cx: number, cy: number, facing = 0): { x: number; y: number } {
  const probe = visualRect({ _uid: "probe", type, x: 0, y: 0, facing } as FurnitureItem);
  if (!probe) return { x: cx, y: cy };
  return { x: cx - (probe.x + probe.w / 2), y: cy - (probe.y + probe.h / 2) };
}
