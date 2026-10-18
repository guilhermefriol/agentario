import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  DECORATION_MAX_BYTES,
  EMPTY_DECORATION,
  normalizeDecoration,
} from "@/features/tv/decoration";

export const runtime = "nodejs";

// Arquivo fixo, fora do git (.agentario/ está no .gitignore). Nada é gravado em ~/.claude.
const FILE =
  process.env.AGENTARIO_DECORATION_FILE?.trim() || path.join(process.cwd(), ".agentario", "decoracao.json");
// Token anti-CSRF por processo: só a página servida por este servidor o conhece.
const TOKEN = randomBytes(24).toString("hex");

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function isLocalRequest(request: Request, requireOrigin: boolean): boolean {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return !requireOrigin;
  try {
    const url = new URL(origin);
    return LOCAL_HOST.test(url.host) && url.host === host;
  } catch {
    return false;
  }
}

const tokenMatches = (value: string | null) => {
  if (!value || value.length !== TOKEN.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(TOKEN));
};

async function readDecoration() {
  try {
    return normalizeDecoration(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch {
    return EMPTY_DECORATION;
  }
}

export async function GET(request: Request) {
  if (!isLocalRequest(request, false)) return NextResponse.json({ error: "proibido" }, { status: 403 });
  return NextResponse.json(
    { decoration: await readDecoration(), token: TOKEN },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  if (!isLocalRequest(request, true)) return NextResponse.json({ error: "proibido" }, { status: 403 });
  if (!tokenMatches(request.headers.get("x-agentario-token"))) {
    return NextResponse.json({ error: "token inválido" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length <= 0 || length > DECORATION_MAX_BYTES) {
    return NextResponse.json({ error: "tamanho inválido" }, { status: 413 });
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > DECORATION_MAX_BYTES) {
    return NextResponse.json({ error: "tamanho inválido" }, { status: 413 });
  }
  let decoration;
  try {
    decoration = normalizeDecoration(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "decoração inválida" }, { status: 400 });
  }
  // Backup da versão anterior + gravação atômica (arquivo temporário + rename).
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  try {
    await fs.copyFile(FILE, `${FILE}.bak`);
  } catch {
    // Primeira gravação: ainda não há o que guardar.
  }
  const temp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(decoration, null, 2), { mode: 0o600 });
  await fs.rename(temp, FILE);
  return NextResponse.json({ decoration }, { headers: { "Cache-Control": "no-store" } });
}
