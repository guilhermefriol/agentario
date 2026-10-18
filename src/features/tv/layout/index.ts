import { buildFlatLayout } from "@/features/tv/layout/build";
import { buildFloorsLayout } from "@/features/tv/layout/floors";
import type { Layout, LayoutDemand, LayoutKind, LayoutRoom } from "@/features/tv/layout/types";

export function buildLayout(kind: LayoutKind, rooms: LayoutRoom[], demand: LayoutDemand): Layout {
  if (kind === "andares") return buildFloorsLayout(rooms, demand);
  return buildFlatLayout(kind, rooms, demand);
}

export * from "@/features/tv/layout/types";
