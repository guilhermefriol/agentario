#!/usr/bin/env node
// Smoke da tela /tv com o painel rodando (npm run tv): abre os 3 layouts e a demonstração,
// conta erros de página, loops do React e confere que a cena não grava no localStorage.
// Uso: npm run smoke:tv  (requer `npx playwright install chromium` uma vez)
import { chromium } from "@playwright/test";

const base = process.env.AGENTARIO_URL || "http://localhost:3210";
const scenarios = ["layout=acesas", "layout=baias", "layout=andares", "layout=acesas&demo=1"];
let failed = false;

const browser = await chromium.launch();
for (const query of scenarios) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await page.goto(`${base}/tv?${query}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(15_000);
  const status = await page.locator("[data-testid=feed-status]").getAttribute("data-status").catch(() => null);
  const storage = await page.evaluate(() => Object.keys(localStorage).filter((key) => key !== "agentario.layout"));
  const ok = status === "connected" && errors.length === 0 && storage.length === 0;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FALHA"} ${query}: status=${status} erros=${errors.length} localStorage=${storage.length}`);
  for (const error of [...new Set(errors)].slice(0, 3)) console.log(`      ${error.slice(0, 160)}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
