import { configureTextBuilder } from "troika-three-text";

export const SCENE_FONT_PATH = "/fonts/noto-sans-latin-regular.ttf";

// Faixas cobertas pela fonte local: ASCII, Latin-1 e pontuação geral (travessões, aspas, reticências).
const SUPPORTED = /[^ -~ -ÿ‐-‧‰-›]/g;

/**
 * Texto seguro para a cena 3D: troca o que a fonte local não cobre por "?". Assim o troika
 * nunca precisa do resolvedor de fontes externo (bloqueado pela CSP), que deixaria a cena
 * suspensa esperando para sempre.
 */
export function sceneSafeText(value: string): string;
export function sceneSafeText(value: string | null | undefined): string | null;
export function sceneSafeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.normalize("NFC").replace(SUPPORTED, "?");
}

let configured = false;

/** Fonte padrão dos textos 3D (URL absoluta: o troika resolve a fonte dentro de um worker). */
export function configureSceneFonts() {
  if (configured || typeof window === "undefined") return;
  configured = true;
  configureTextBuilder({ defaultFontURL: new URL(SCENE_FONT_PATH, window.location.origin).href });
}
