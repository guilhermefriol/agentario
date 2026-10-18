// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildNavGrid } from "@/features/retro-office/core/navigation";
import {
  decorSlot,
  decorationItems,
  normalizeDecoration,
  DECOR_TYPES,
} from "@/features/tv/decoration";
import { buildLayout } from "@/features/tv/layout";

describe("decoração", () => {
  it("normaliza: descarta zonas, tipos, lugares e duplicados inválidos", () => {
    const clean = normalizeDecoration({
      version: 1,
      zones: {
        centro: [
          { type: "lamp", slot: 0 },
          { type: "lamp", slot: 0 },
          { type: "wall", slot: 1 },
          { type: "clock", slot: 9 },
          { type: "mug", slot: 2 },
        ],
        "../../etc": [{ type: "lamp", slot: 0 }],
        "lazer:igreja": "x",
      },
    });
    expect(clean).toEqual({ version: 1, zones: { centro: [{ type: "lamp", slot: 0 }, { type: "mug", slot: 2 }] } });
    expect(() => normalizeDecoration({ version: 2, zones: {} })).toThrow();
  });

  it("itens ficam dentro da sala e não mudam a navegação", () => {
    const rooms = [{ id: "p-0123456789", label: "Projeto", lit: true }];
    const layout = buildLayout("acesas", rooms, { seatsByRoom: { "p-0123456789": 2 }, population: 5 });
    const types = Object.keys(DECOR_TYPES) as Array<keyof typeof DECOR_TYPES>;
    const decoration = {
      version: 1 as const,
      zones: Object.fromEntries(
        layout.zones.map((zone) => [zone.id, types.slice(0, 8).map((type, slot) => ({ type, slot }))]),
      ),
    };
    const items = decorationItems(layout.zones, decoration);
    expect(items).toHaveLength(layout.zones.length * 8);
    for (const zone of layout.zones) {
      for (let slot = 0; slot < 8; slot += 1) {
        const p = decorSlot(zone, slot);
        expect(p.x).toBeGreaterThan(zone.x);
        expect(p.x).toBeLessThan(zone.x + zone.w);
        expect(p.y).toBeGreaterThan(zone.y);
        expect(p.y).toBeLessThan(zone.y + zone.h);
      }
    }
    expect(buildNavGrid([...layout.furniture, ...items])).toEqual(buildNavGrid(layout.furniture));
  });
});

describe("rota de decoração", () => {
  let dir: string;
  let route: typeof import("@/app/api/agentario/decoracao/route");
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentario-decor-"));
    vi.stubEnv("AGENTARIO_DECORATION_FILE", path.join(dir, "decoracao.json"));
    route = await import("@/app/api/agentario/decoracao/route");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const body = JSON.stringify({ version: 1, zones: { centro: [{ type: "lamp", slot: 0 }] } });
  const put = (headers: Record<string, string>, payload = body) =>
    route.PUT(
      new Request("http://localhost:3210/api/agentario/decoracao", {
        method: "PUT",
        headers: { "content-length": String(Buffer.byteLength(payload)), ...headers },
        body: payload,
      }),
    );

  it("GET local devolve decoração e token; host externo é recusado", async () => {
    const ok = await route.GET(new Request("http://localhost:3210/api/agentario/decoracao", { headers: { host: "localhost:3210" } }));
    expect(ok.status).toBe(200);
    const json = await ok.json();
    expect(json.decoration).toEqual({ version: 1, zones: {} });
    expect(typeof json.token).toBe("string");
    const bad = await route.GET(new Request("http://evil.example/api", { headers: { host: "evil.example" } }));
    expect(bad.status).toBe(403);
  });

  it("PUT exige Origin igual ao host, token válido e tamanho/esquema corretos; grava com backup", async () => {
    const { token } = await (
      await route.GET(new Request("http://localhost:3210/x", { headers: { host: "localhost:3210" } }))
    ).json();
    const base = { host: "localhost:3210", origin: "http://localhost:3210" };
    expect((await put({ ...base, origin: "http://evil.example" , "x-agentario-token": token })).status).toBe(403);
    expect((await put({ host: "localhost:3210", "x-agentario-token": token })).status).toBe(403);
    expect((await put({ ...base, "x-agentario-token": "errado" })).status).toBe(403);
    expect((await put({ ...base, "x-agentario-token": token }, "{nao-json")).status).toBe(400);
    expect((await put({ ...base, "x-agentario-token": token })).status).toBe(200);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "decoracao.json"), "utf8"));
    expect(saved).toEqual({ version: 1, zones: { centro: [{ type: "lamp", slot: 0 }] } });
    expect((await put({ ...base, "x-agentario-token": token })).status).toBe(200);
    expect(fs.existsSync(path.join(dir, "decoracao.json.bak"))).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    const huge = JSON.stringify({ version: 1, zones: {}, pad: "x".repeat(70_000) });
    expect((await put({ ...base, "x-agentario-token": token }, huge)).status).toBe(413);
  });
});
