"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createTailer } = require("./tail");
const { projectRoots, listProjectFolders, readRegisteredAgents } = require("./rooms");

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
function createWatcher({ config, state, roots = projectRoots(config.claudeDir) }) {
  const projectsDir = roots.real;
  const tailers = new Map(); // caminho → { tailer, ingest }
  const staffCache = new Map(); // pasta → { mtimeMs, staff }

  const track = (filePath, ingest) => {
    if (!tailers.has(filePath)) tailers.set(filePath, { tailer: createTailer(filePath), ingest });
  };

  function staffOf(folder) {
    const agentsDir = path.join(projectsDir, folder, ".claude", "agents");
    const mtimeMs = lstatOrNull(agentsDir)?.mtimeMs ?? 0;
    const cached = staffCache.get(folder);
    if (cached && cached.mtimeMs === mtimeMs) return cached.staff;
    const staff = mtimeMs ? readRegisteredAgents(roots, folder) : [];
    staffCache.set(folder, { mtimeMs, staff });
    return staff;
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

  /** Redescobre salas (pastas de projeto) e arquivos de transcript. */
  function discover(now = Date.now()) {
    state.setProjects(
      listProjectFolders(roots, config.exclude).map((key) => ({ key, staff: staffOf(key) })),
    );
    for (const dirEntry of listEntries(projectsDir)) {
      if (!dirEntry.isDirectory() || !dirEntry.name.startsWith("-")) continue;
      const transcriptDir = path.join(projectsDir, dirEntry.name);
      for (const entry of listEntries(transcriptDir)) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const filePath = path.join(transcriptDir, entry.name);
        const stat = lstatOrNull(filePath);
        if (!stat || !stat.isFile()) continue;
        const sessionId = entry.name.slice(0, -".jsonl".length);
        if (now - stat.mtimeMs > RECENT_FILE_MS) continue;
        track(filePath, (record) => state.ingestSession(sessionId, record));
        discoverInterns(transcriptDir, sessionId, now);
      }
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
