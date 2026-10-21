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
import { CELL } from "@/features/tv/layout/rooms";
import type { Layout, Zone } from "@/features/tv/layout/types";
import { sceneSafeText } from "@/features/tv/sceneText";

// Tons quentes nas salas de trabalho e frios nas de descanso (dicas de decoração de escritório).
const FLOOR_LIT = "#efe1c8";
const FLOOR_DARK = "#2a2622";
const FLOOR_LEISURE = "#d3e3e8";
const FLOOR_WAITING = "#dde3ea";
const FLOOR_CENTER = "#f1d98a";
const GROUND = "#1d1b19";
const SUN = "#f5c542";

/** Retângulo do canvas → centro e tamanho no mundo. */
const worldRect = (zone: Pick<Zone, "x" | "y" | "w" | "h">) => {
  const [cx, , cz] = toWorld(zone.x + zone.w / 2, zone.y + zone.h / 2);
  return { cx, cz, w: zone.w * SCALE, h: zone.h * SCALE };
};

const zoneColor = (zone: Zone) =>
  zone.kind === "center"
    ? FLOOR_CENTER
    : zone.kind === "leisure"
      ? FLOOR_LEISURE
      : zone.kind === "waiting"
        ? FLOOR_WAITING
        : zone.lit
          ? FLOOR_LIT
          : FLOOR_DARK;

/** Tapete na cor de identidade da sala, sob as mesas (mais apagado com a sala escura). */
function Rug({ zone }: { zone: Zone }) {
  if (zone.kind !== "project" || !zone.accent) return null;
  const rug = { x: zone.x + CELL, y: zone.y + CELL + CELL / 2, w: zone.w - 2 * CELL, h: zone.h - 3 * CELL };
  const { cx, cz, w, h } = worldRect(rug);
  return (
    <mesh position={[cx, 0.005, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color={zone.accent} roughness={1} transparent opacity={zone.lit ? 0.75 : 0.22} />
    </mesh>
  );
}

/** "Sol" no chão da sala do Friol: o centro do universo. */
function Sun({ zone }: { zone: Zone }) {
  const [x, , z] = toWorld(zone.x + zone.w / 2, zone.y + zone.h / 2);
  const rays = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);
  return (
    <group position={[x, 0.006, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh>
        <circleGeometry args={[0.9, 48]} />
        <meshStandardMaterial color={SUN} emissive={SUN} emissiveIntensity={0.35} roughness={0.6} />
      </mesh>
      {rays.map((angle, i) => (
        <mesh key={`raio-${i}`} position={[Math.cos(angle) * 1.45, Math.sin(angle) * 1.45, 0]} rotation={[0, 0, angle]}>
          <planeGeometry args={[i % 2 === 0 ? 0.9 : 0.55, 0.12]} />
          <meshStandardMaterial color={SUN} emissive={SUN} emissiveIntensity={0.25} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

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
    <Billboard position={[x, 1.55, z]}>
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
        {sceneSafeText(zone.label)}
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

export const TvEnvironment = memo(function TvEnvironment({ layout }: { layout: Layout }) {
  const { bounds, zones } = layout;
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
        <Rug key={`rug-${zone.id}`} zone={zone} />
      ))}
      {zones
        .filter((zone) => zone.kind === "center")
        .map((zone) => (
          <Sun key="sol" zone={zone} />
        ))}
      {zones.map((zone) => (
        <ZoneLabel key={`label-${zone.id}`} zone={zone} />
      ))}
      {church ? <ChurchFurniture zone={church} /> : null}
      {bathroom ? <BathroomStalls zone={bathroom} /> : null}
      {hasCenter ? <Halo layout={layout} /> : null}
      {hasCenter && layout.flags ? (
        <>
          <OfficeFlagPole position={toWorld(layout.flags.russia.x, layout.flags.russia.y)} rotY={0.32} art={<RussiaFlagArt />} />
          <OfficeFlagPole position={toWorld(layout.flags.brazil.x, layout.flags.brazil.y)} rotY={0.32} art={<BrazilFlagArt />} />
        </>
      ) : null}
    </group>
  );
});
