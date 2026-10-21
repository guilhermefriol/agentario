// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RenderAgent } from "@/features/retro-office/core/types";
import { applyAgentCollisionBumps } from "@/features/retro-office/systems/NavigationSystem";

const walker = (id: string, x: number, directed: boolean) =>
  ({ id, x, y: 1000, targetX: 3000, targetY: 1500, path: [], state: "walking", facing: 0, frame: 0, directed }) as unknown as RenderAgent;

describe("esbarrão entre bonecos", () => {
  it("no modo dirigido (TV) o boneco mantém o próprio destino e não foge para fora do mapa", () => {
    const bumped = applyAgentCollisionBumps({ agents: [walker("a", 2000, true), walker("b", 2002, true)], now: 1 });
    for (const agent of bumped) {
      expect(agent.bumpedUntil).toBeDefined();
      expect([agent.targetX, agent.targetY]).toEqual([3000, 1500]);
    }
  });
});
