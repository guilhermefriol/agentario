"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_CONFIG_PATH = path.join(REPO_ROOT, "agentario.config.local.json");

const DEFAULTS = Object.freeze({
  claudeDir: "~/.claude",
  activeWindowSeconds: 120,
  idleFallbackSeconds: 600,
  presenceHours: 8,
  fiscalMinutes: 10,
  showRealNames: true,
  showTasks: true,
  night: { enabled: false, from: "22:00", to: "07:00" },
  exclude: [],
  projects: {},
});

const TASK_POLICIES = new Set(["publico", "interno", "oculto"]);


const expandHome = (value) =>
  value === "~" || value.startsWith("~/") ? path.join(os.homedir(), value.slice(1)) : value;

const positiveNumber = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const normalizeProjects = (raw) => {
  const projects = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return projects;
  for (const [folder, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    projects[folder] = {
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null,
      hidden: entry.hidden === true,
      // Sem valor → público (tarefas visíveis por padrão); valor inválido → oculto.
      tasks:
        entry.tasks === undefined ? "publico" : TASK_POLICIES.has(entry.tasks) ? entry.tasks : "oculto",
    };
  }
  return projects;
};

/** Normaliza um objeto de config cru (do arquivo local) aplicando defaults. */
function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const night = input.night && typeof input.night === "object" ? input.night : {};
  return {
    claudeDir: path.resolve(
      expandHome(typeof input.claudeDir === "string" ? input.claudeDir : DEFAULTS.claudeDir)
    ),
    activeWindowSeconds: positiveNumber(input.activeWindowSeconds, DEFAULTS.activeWindowSeconds),
    idleFallbackSeconds: positiveNumber(input.idleFallbackSeconds, DEFAULTS.idleFallbackSeconds),
    presenceHours: positiveNumber(input.presenceHours, DEFAULTS.presenceHours),
    fiscalMinutes: positiveNumber(input.fiscalMinutes, DEFAULTS.fiscalMinutes),
    showRealNames: input.showRealNames !== false,
    showTasks: input.showTasks !== false,
    night: {
      enabled: night.enabled === true,
      from: typeof night.from === "string" ? night.from : DEFAULTS.night.from,
      to: typeof night.to === "string" ? night.to : DEFAULTS.night.to,
    },
    exclude: Array.isArray(input.exclude)
      ? input.exclude.filter((pattern) => typeof pattern === "string" && pattern.trim())
      : [],
    projects: normalizeProjects(input.projects),
  };
}

/** Lê o config local (fora do git). Arquivo ausente ou inválido → defaults. */
function loadConfig(env = process.env) {
  const configPath = env.AGENTARIO_CONFIG?.trim() || DEFAULT_CONFIG_PATH;
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch {
    return normalizeConfig({});
  }
}

module.exports = { loadConfig, normalizeConfig };
