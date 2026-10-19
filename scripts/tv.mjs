#!/usr/bin/env node
// Sobe o adaptador do Agentário e a interface juntos. Se um cair, derruba o outro.
// Uso: npm run tv            (desenvolvimento)
//      npm run tv -- --prod  (usa o build de `npm run build`)
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiPort = Number.parseInt(process.env.PORT || "3210", 10);
const adapterPort = Number.parseInt(process.env.AGENTARIO_ADAPTER_PORT || "18790", 10);
const prod = process.argv.includes("--prod");

const portIsFree = (port) =>
  new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });

for (const [label, port] of [["interface", uiPort], ["adaptador", adapterPort]]) {
  if (!(await portIsFree(port))) {
    console.error(`[tv] porta ${port} (${label}) já está em uso. Pare o processo que a usa e tente de novo.`);
    process.exit(1);
  }
}

const env = {
  ...process.env,
  PORT: String(uiPort),
  AGENTARIO_ADAPTER_PORT: String(adapterPort),
  NEXT_PUBLIC_AGENTARIO_ADAPTER_URL: `ws://localhost:${adapterPort}`,
};

const children = [];
let stopping = false;

const start = (name, args) => {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit", detached: true });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`[tv] ${name} saiu (${signal ?? code}); derrubando o resto.`);
    stop(1);
  });
  children.push(child);
};

const stop = (exitCode) => {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM"); // grupo inteiro (inclui filhos do next)
    } catch {}
  }
  setTimeout(() => process.exit(exitCode), 1500).unref();
};

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

start("adaptador", ["server/claude-code/adapter.js"]);
start("interface", prod ? ["server/index.js"] : ["server/index.js", "--dev"]);
console.log(`[tv] abra http://localhost:${uiPort}/tv`);
