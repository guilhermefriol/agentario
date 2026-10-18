"use strict";

const fs = require("node:fs");

const INITIAL_TAIL_BYTES = 256 * 1024;
const MAX_READ_PER_POLL = 4 * 1024 * 1024;

const parseLine = (buffer) => {
  if (buffer.length === 0) return null;
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
};

const readRange = (filePath, start, length) => {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
};

/**
 * Leitor incremental de JSONL. Começa nos últimos 256 KB (descartando o fragmento
 * inicial), guarda linha incompleta entre leituras e recomeça se o arquivo for
 * truncado ou substituído (inode diferente).
 */
function createTailer(filePath, options = {}) {
  const initialTailBytes = options.initialTailBytes ?? INITIAL_TAIL_BYTES;
  let offset = null;
  let ino = null;
  let partial = Buffer.alloc(0);
  let skipFirstFragment = false;

  const reset = (stat) => {
    ino = stat.ino;
    partial = Buffer.alloc(0);
    offset = Math.max(0, stat.size - initialTailBytes);
    skipFirstFragment = offset > 0;
  };

  /** Retorna os registros novos desde a última leitura. */
  function read() {
    let stat;
    try {
      stat = fs.lstatSync(filePath);
    } catch {
      return [];
    }
    if (!stat.isFile()) return [];
    if (offset === null || stat.ino !== ino || stat.size < offset) reset(stat);
    if (stat.size === offset) return [];

    const length = Math.min(stat.size - offset, MAX_READ_PER_POLL);
    let chunk = readRange(filePath, offset, length);
    offset += chunk.length;

    if (skipFirstFragment) {
      const newline = chunk.indexOf(0x0a);
      if (newline === -1) return [];
      chunk = chunk.subarray(newline + 1);
      skipFirstFragment = false;
    }

    const data = partial.length > 0 ? Buffer.concat([partial, chunk]) : chunk;
    const records = [];
    let start = 0;
    let newline = data.indexOf(0x0a, start);
    while (newline !== -1) {
      const record = parseLine(data.subarray(start, newline));
      if (record) records.push(record);
      start = newline + 1;
      newline = data.indexOf(0x0a, start);
    }
    partial = Buffer.from(data.subarray(start));
    return records;
  }

  return { read, get offset() { return offset; } };
}

module.exports = { createTailer };
