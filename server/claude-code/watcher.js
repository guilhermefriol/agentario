"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createTailer, readCwdFromHead } = require("./tail");

const RECENT_FILE_MS = 24 * 3600 * 1000;
const META_MAX_BYTES = 64 * 1024;

const lstatOrNull = (target) => {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
};

const listEntries = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const readMeta = (metaPath) => {
  const stat = lstatOrNull(metaPath);
  if (!stat || !stat.isFile() || stat.size > META_MAX_BYTES) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * Varre `<claudeDir>/projects` (só pastas de transcript, que começam com "-"),
 * ignora symlinks e alimenta o estado com os registros novos. Somente leitura.
 */
function createWatcher({ config, state }) {
  const projectsDir = path.join(config.claudeDir, "projects");
  const tailers = new Map(); // caminho → { tailer, ingest }
  const headCwdCache = new Map(); // caminho → { mtimeMs, cwd }

  const track = (filePath, ingest) => {
    if (!tailers.has(filePath)) tailers.set(filePath, { tailer: createTailer(filePath), ingest });
  };

  function registerIdleRoom(filePath, stat) {
    const cached = headCwdCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return state.registerProject(cached.cwd);
    const cwd = readCwdFromHead(filePath);
    headCwdCache.set(filePath, { mtimeMs: stat.mtimeMs, cwd });
    state.registerProject(cwd);
  }

  function discoverInterns(transcriptDir, sessionId, now) {
    const subagentsDir = path.join(transcriptDir, sessionId, "subagents");
    const dirStat = lstatOrNull(subagentsDir);
    if (!dirStat || !dirStat.isDirectory()) return;
    for (const entry of listEntries(subagentsDir)) {
      if (!entry.isFile() || !/^agent-[\w-]+\.jsonl$/.test(entry.name)) continue;
      const filePath = path.join(subagentsDir, entry.name);
      const stat = lstatOrNull(filePath);
      if (!stat || !stat.isFile() || now - stat.mtimeMs > RECENT_FILE_MS) continue;
      if (tailers.has(filePath)) continue;
      const agentFileId = `${sessionId}/${entry.name}`;
      const meta = readMeta(filePath.replace(/\.jsonl$/, ".meta.json"));
      const info = { sessionId, toolUseId: meta.toolUseId, agentType: meta.agentType };
      track(filePath, (record) => state.ingestIntern(agentFileId, info, record));
    }
  }

  /** Redescobre pastas e arquivos de transcript. */
  function discover(now = Date.now()) {
    for (const dirEntry of listEntries(projectsDir)) {
      if (!dirEntry.isDirectory() || !dirEntry.name.startsWith("-")) continue;
      const transcriptDir = path.join(projectsDir, dirEntry.name);
      let newestIdle = null;
      for (const entry of listEntries(transcriptDir)) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const filePath = path.join(transcriptDir, entry.name);
        const stat = lstatOrNull(filePath);
        if (!stat || !stat.isFile()) continue;
        const sessionId = entry.name.slice(0, -".jsonl".length);
        if (now - stat.mtimeMs <= RECENT_FILE_MS) {
          track(filePath, (record) => state.ingestSession(sessionId, record));
          discoverInterns(transcriptDir, sessionId, now);
        } else if (!newestIdle || stat.mtimeMs > newestIdle.stat.mtimeMs) {
          newestIdle = { filePath, stat };
        }
      }
      if (newestIdle) registerIdleRoom(newestIdle.filePath, newestIdle.stat);
    }
  }

  /** Lê os bytes novos de todos os arquivos acompanhados. */
  function poll() {
    let records = 0;
    for (const { tailer, ingest } of tailers.values()) {
      for (const record of tailer.read()) {
        ingest(record);
        records += 1;
      }
    }
    return records;
  }

  return { discover, poll, get trackedFiles() { return tailers.size; } };
}

module.exports = { createWatcher };
