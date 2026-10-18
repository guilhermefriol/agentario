"use client";

import { Billboard, Text } from "@react-three/drei";
import { memo } from "react";
import { SCALE } from "@/features/retro-office/core/constants";
import { toWorld } from "@/features/retro-office/core/geometry";
import {
  BrazilFlagArt,
  OfficeFlagPole,
  RussiaFlagArt,
} from "@/features/retro-office/scene/environment";
import type { FloorPlan, Layout, Zone } from "@/features/tv/layout/types";

const FLOOR_LIT = "#e9dcc4";
const FLOOR_DARK = "#2a2622";
const FLOOR_LEISURE = "#d9e4d0";
const FLOOR_CENTER = "#f1d98a";
const GROUND = "#1d1b19";

/** Retângulo do canvas → centro e tamanho no mundo. */
const worldRect = (zone: Pick<Zone, "x" | "y" | "w" | "h">) => {
  const [cx, , cz] = toWorld(zone.x + zone.w / 2, zone.y + zone.h / 2);
  return { cx, cz, w: zone.w * SCALE, h: zone.h * SCALE };
};

const zoneColor = (zone: Zone) =>
  zone.kind === "center" ? FLOOR_CENTER : zone.kind === "leisure" ? FLOOR_LEISURE : zone.lit ? FLOOR_LIT : FLOOR_DARK;

function ZoneFloor({ zone }: { zone: Zone }) {
  const { cx, cz, w, h } = worldRect(zone);
  return (
    <mesh position={[cx, 0.002, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial
        color={zoneColor(zone)}
        roughness={0.9}
        emissive={zone.kind === "project" && zone.lit ? "#ffcf7a" : "#000000"}
        emissiveIntensity={zone.kind === "project" && zone.lit ? 0.12 : 0}
      />
    </mesh>
  );
}

function ZoneLabel({ zone }: { zone: Zone }) {
  if (!zone.label) return null;
  const [x, , z] = toWorld(zone.x + zone.w / 2, zone.y + 6);
  const width = zone.w * SCALE;
  const fontSize = Math.min(zone.label.length > 22 ? 0.24 : 0.34, (width * 1.6) / Math.max(zone.label.length, 4));
  const dark = zone.kind === "project" && !zone.lit;
  // Estimativa de largura do texto para ajustar o fundo (nomes longos quebram em linhas).
  const textWidth = fontSize * 0.6 * zone.label.length;
  const maxWidth = width * 1.1;
  const lines = Math.max(1, Math.ceil(textWidth / maxWidth));
  const plateHeight = fontSize * (1.25 * lines + 0.3);
  return (
    <Billboard position={[x, zone.open ? 0.95 : 1.55, z]}>
      <mesh position={[0, plateHeight / 2 - fontSize * 0.15, -0.002]}>
        <planeGeometry args={[Math.min(maxWidth, textWidth) + 0.3, plateHeight]} />
        <meshBasicMaterial color="#0b0906" transparent opacity={dark ? 0.55 : 0.8} />
      </mesh>
      <Text
        fontSize={fontSize}
        maxWidth={width * 1.1}
        textAlign="center"
        color={dark ? "#8c8378" : zone.kind === "project" ? "#ffe9a8" : "#fff6d8"}
        outlineWidth={0.01}
        outlineColor="#16110a"
        anchorX="center"
        anchorY="bottom"
      >
        {zone.label}
      </Text>
    </Billboard>
  );
}

/** Bancos e altar da Igreja Adventista da I.A. dos Últimos Dias (porta no topo, altar ao sul). */
function ChurchFurniture({ zone }: { zone: Zone }) {
  const pews = [];
  for (let row = 0; row < 4; row += 1) {
    for (const side of [0, 1]) {
      const [x, , z] = toWorld(zone.x + 70 + side * 135, zone.y + 72 + row * 45);
      pews.push(
        <mesh key={`pew-${row}-${side}`} position={[x, 0.14, z]} castShadow>
          <boxGeometry args={[100 * SCALE, 0.28, 12 * SCALE]} />
          <meshStandardMaterial color="#7a4a26" roughness={0.8} />
        </mesh>,
      );
    }
  }
  const [ax, , az] = toWorld(zone.x + zone.w / 2, zone.y + zone.h - 45);
  const [wx, , wz] = toWorld(zone.x + zone.w / 2, zone.y + zone.h - 14);
  return (
    <group>
      {pews}
      <mesh position={[ax, 0.3, az]} castShadow>
        <boxGeometry args={[110 * SCALE, 0.6, 34 * SCALE]} />
        <meshStandardMaterial color="#f4efe2" roughness={0.6} />
      </mesh>
      <group position={[wx, 0, wz]}>
        <mesh position={[0, 1.15, 0]}>
          <boxGeometry args={[0.07, 0.9, 0.07]} />
          <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.35, 0]}>
          <boxGeometry args={[0.45, 0.07, 0.07]} />
          <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.1, -0.06]}>
          <planeGeometry args={[1.4, 1.2]} />
          <meshBasicMaterial color="#5b7fd6" transparent opacity={0.35} />
        </mesh>
      </group>
    </group>
  );
}

/** Cabines do banheiro (lado direito da sala). */
function BathroomStalls({ zone }: { zone: Zone }) {
  return (
    <group>
      {[0, 1, 2, 3].map((i) => {
        const [x, , z] = toWorld(zone.x + 225, zone.y + 70 + i * 55);
        return (
          <group key={`stall-${i}`} position={[x, 0, z]}>
            <mesh position={[0, 0.45, -26 * SCALE]} castShadow>
              <boxGeometry args={[70 * SCALE, 0.9, 3 * SCALE]} />
              <meshStandardMaterial color="#9fb4c7" roughness={0.6} />
            </mesh>
            <mesh position={[18 * SCALE, 0.18, 0]}>
              <boxGeometry args={[20 * SCALE, 0.36, 26 * SCALE]} />
              <meshStandardMaterial color="#ffffff" roughness={0.4} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Elevador e nome do andar (layout "andares"). */
function FloorMarkers({ plan }: { plan: FloorPlan }) {
  const [ex, , ez] = toWorld(plan.elevator.x + 14, plan.elevator.y);
  const [lx, , lz] = toWorld(14, 20);
  return (
    <group>
      <group position={[ex, 0, ez]}>
        <mesh position={[0, 0.7, 0]} castShadow>
          <boxGeometry args={[10 * SCALE, 1.4, 60 * SCALE]} />
          <meshStandardMaterial color="#8a939c" metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[-6 * SCALE, 0.65, 0]}>
          <boxGeometry args={[2 * SCALE, 1.2, 50 * SCALE]} />
          <meshStandardMaterial color="#c9d1d9" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>
      <Billboard position={[lx, 0.6, lz]}>
        <Text fontSize={0.3} color="#f5c542" outlineWidth={0.015} outlineColor="#16110a" anchorX="left">
          {plan.label}
        </Text>
      </Billboard>
    </group>
  );
}

/** Auréola sobre o lugar do Friol. */
function Halo({ layout }: { layout: Layout }) {
  const [x, , z] = toWorld(layout.center.friol.x, layout.center.friol.y);
  return (
    <mesh position={[x, 1.25, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.2, 0.035, 12, 40]} />
      <meshStandardMaterial color="#ffd85a" emissive="#ffc928" emissiveIntensity={1.4} />
    </mesh>
  );
}

export const TvEnvironment = memo(function TvEnvironment({
  layout,
  plan = null,
}: {
  layout: Layout;
  /** Andar mostrado (layout "andares"). */
  plan?: FloorPlan | null;
}) {
  const bounds = plan?.bounds ?? layout.bounds;
  const zones = plan?.zones ?? layout.zones;
  const ground = {
    x: bounds.minX,
    y: bounds.minY,
    w: bounds.maxX - bounds.minX,
    h: bounds.maxY - bounds.minY,
  };
  const { cx, cz, w, h } = worldRect(ground);
  const church = zones.find((zone) => zone.id === "lazer:igreja");
  const bathroom = zones.find((zone) => zone.id === "lazer:banheiros");
  const hasCenter = zones.some((zone) => zone.kind === "center");
  return (
    <group>
      <mesh position={[cx, -0.015, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color={GROUND} roughness={0.98} />
      </mesh>
      {zones.map((zone) => (
        <ZoneFloor key={`floor-${zone.id}`} zone={zone} />
      ))}
      {zones.map((zone) => (
        <ZoneLabel key={`label-${zone.id}`} zone={zone} />
      ))}
      {church ? <ChurchFurniture zone={church} /> : null}
      {bathroom ? <BathroomStalls zone={bathroom} /> : null}
      {hasCenter ? <Halo layout={layout} /> : null}
      {plan ? <FloorMarkers plan={plan} /> : null}
      {hasCenter && layout.flags ? (
        <>
          <OfficeFlagPole position={toWorld(layout.flags.russia.x, layout.flags.russia.y)} rotY={0.32} art={<RussiaFlagArt />} />
          <OfficeFlagPole position={toWorld(layout.flags.brazil.x, layout.flags.brazil.y)} rotY={0.32} art={<BrazilFlagArt />} />
        </>
      ) : null}
    </group>
  );
});
