// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("troika-three-text", () => ({ configureTextBuilder: vi.fn() }));
const { sceneSafeText } = await import("@/features/tv/sceneText");

describe("sceneSafeText", () => {
  it("mantém português e pontuação comum; troca o que a fonte não cobre", () => {
    expect(sceneSafeText("Igreja Adventista da I.A. dos Últimos Dias")).toBe("Igreja Adventista da I.A. dos Últimos Dias");
    expect(sceneSafeText("1º andar · Dária — “ok”…")).toBe("1º andar · Dária — “ok”…");
    expect(sceneSafeText("projeto ✨ 日本 Андрей")).toBe("projeto ? ?? ??????");
    expect(sceneSafeText(null)).toBeNull();
  });
});
