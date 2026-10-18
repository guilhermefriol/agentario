"use strict";

const fs = require("node:fs");
const path = require("node:path");

const AGENT_FILE_MAX_BYTES = 8 * 1024;
const AGENT_NAME_MAX = 32;

const realpathOrNull = (target) => {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
};

const isInside = (root, target) => target === root || target.startsWith(root + path.sep);

/**
 * Raízes da pasta de projetos: a real (symlinks resolvidos) e a literal, porque o
 * `cwd` gravado nos transcripts pode usar qualquer uma das duas.
 */
function projectRoots(claudeDir) {
  const literal = path.resolve(claudeDir, "projects");
  const real = realpathOrNull(literal) || literal;
  return { real, literal, all: [...new Set([real, literal])] };
}

/**
 * Para onde vai uma sessão pelo `cwd`: subpasta de projects/X → sala X;
 * a própria raiz → centro; qualquer outro lugar → fora (ignorada).
 */
function locateCwd(cwd, roots) {
  if (typeof cwd !== "string" || !cwd) return { kind: "external", key: null };
  const normalized = path.resolve(cwd);
  for (const root of roots.all) {
    if (normalized === root) return { kind: "center", key: null };
    if (normalized.startsWith(root + path.sep)) {
      const key = normalized.slice(root.length + 1).split(path.sep)[0];
      if (key && !key.startsWith("-") && !key.startsWith(".")) return { kind: "room", key };
      return { kind: "external", key: null };
    }
  }
  return { kind: "external", key: null };
}

const compileExclude = (patterns) =>
  (Array.isArray(patterns) ? patterns : []).flatMap((pattern) => {
    try {
      return [new RegExp(pattern, "i")];
    } catch {
      return [];
    }
  });

/** Pastas de projeto: diretórios reais de 1º nível, sem `-`/`.` no início, fora do `exclude`. */
function listProjectFolders(roots, exclude = []) {
  const patterns = compileExclude(exclude);
  let entries;
  try {
    entries = fs.readdirSync(roots.real, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("-") && !name.startsWith("."))
    .filter((name) => !patterns.some((re) => re.test(name)))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

const sanitizeAgentName = (value) =>
  value
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .trim()
    .slice(0, AGENT_NAME_MAX);

/** Lê só o `name` do frontmatter (uma linha). Descrições e o corpo do arquivo não saem daqui. */
function frontmatterName(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  for (const line of text.slice(3, end).split("\n")) {
    const match = /^name\s*:\s*["']?([^"'\n]+?)["']?\s*$/.exec(line);
    if (match) return match[1];
  }
  return null;
}

/**
 * Agentes cadastrados de um projeto (`<projeto>/.claude/agents/*.md`).
 * Recusa qualquer caminho que, resolvido, saia da pasta do projeto.
 */
function readRegisteredAgents(roots, folder) {
  const projectDir = realpathOrNull(path.join(roots.real, folder));
  if (!projectDir || !isInside(roots.real, projectDir)) return [];
  const agentsDir = realpathOrNull(path.join(projectDir, ".claude", "agents"));
  if (!agentsDir || !isInside(projectDir, agentsDir)) return [];

  let entries;
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = new Map(); // nome normalizado → nome exibido (unifica duplicados)
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(agentsDir, entry.name);
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > AGENT_FILE_MAX_BYTES) continue;
    let text;
    try {
      text = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const name = sanitizeAgentName(frontmatterName(text) || entry.name.replace(/\.md$/, ""));
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

module.exports = { projectRoots, locateCwd, listProjectFolders, readRegisteredAgents };
