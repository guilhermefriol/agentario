"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BLOCKING_TYPES,
  DECOR_SLOTS,
  DECOR_TYPES,
  EMPTY_DECORATION,
  ITEM_LABELS,
  MAX_WALLS,
  normalizeDecoration,
  type Decoration,
  type DecorWall,
  type ItemType,
  type ZoneDecoration,
} from "@/features/tv/decoration";

const ENDPOINT = "/api/agentario/decoracao";

/** Carrega e salva a decoração local (rota só da própria máquina, com token anti-CSRF). */
export function useDecoration() {
  const [decoration, setDecoration] = useState<Decoration>(EMPTY_DECORATION);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(ENDPOINT, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((payload: { decoration: unknown; token: string }) => {
        if (cancelled) return;
        setDecoration(normalizeDecoration(payload.decoration));
        setToken(payload.token);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar a decoração.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(
    async (next: Decoration) => {
      setDecoration(next);
      if (!token) return;
      try {
        const response = await fetch(ENDPOINT, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-agentario-token": token },
          body: JSON.stringify(next),
        });
        if (!response.ok) throw new Error(String(response.status));
        setError(null);
      } catch {
        setError("Não foi possível salvar a decoração.");
      }
    },
    [token],
  );

  return { decoration, save, error };
}

type Props = {
  zones: Array<{ id: string; label: string }>;
  decoration: Decoration;
  error: string | null;
  /** Zonas cuja decoração bloqueante foi descartada para manter tudo alcançável. */
  dropped: string[];
  /** Devolve uma mensagem se a decoração deixar algo inalcançável em algum layout. */
  validate: (next: Decoration) => string | null;
  onChange: (next: Decoration) => void;
  onClose: () => void;
};

const EMPTY_ZONE: ZoneDecoration = { items: [], walls: [] };

/** Painel do modo edição: decoração, móveis grandes e paredes internas por sala. */
export function DecorationPanel({ zones, decoration, error, dropped, validate, onChange, onClose }: Props) {
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? "");
  const [refused, setRefused] = useState<string | null>(null);
  const [wall, setWall] = useState<DecorWall>({ c: 2, r: 2, len: 3, dir: "h" });
  const activeZone = zones.some((zone) => zone.id === zoneId) ? zoneId : (zones[0]?.id ?? "");
  const current = decoration.zones[activeZone] ?? EMPTY_ZONE;
  const labelOf = (id: string) => zones.find((zone) => zone.id === id)?.label ?? id;

  const commit = (zone: ZoneDecoration) => {
    const zonesNext = { ...decoration.zones };
    if (zone.items.length > 0 || zone.walls.length > 0) zonesNext[activeZone] = zone;
    else delete zonesNext[activeZone];
    const next: Decoration = { version: 2, zones: zonesNext };
    const problem = validate(next);
    if (problem) {
      setRefused(problem);
      return;
    }
    setRefused(null);
    onChange(next);
  };
  const add = (type: ItemType) => {
    const used = new Set(current.items.map((item) => item.slot));
    const slot = Array.from({ length: DECOR_SLOTS }, (_, i) => i).find((i) => !used.has(i));
    if (slot === undefined) return;
    commit({ ...current, items: [...current.items, { type, slot }] });
  };
  const numberField = (key: "c" | "r" | "len", label: string, max: number) => (
    <label className="flex flex-col text-xs text-amber-600">
      {label}
      <input
        type="number"
        min={1}
        max={max}
        value={wall[key]}
        onChange={(event) => setWall({ ...wall, [key]: Math.max(1, Math.min(max, Number(event.target.value) || 1)) })}
        className="w-14 rounded bg-black/60 px-1 py-0.5 text-amber-50"
      />
    </label>
  );

  return (
    <aside
      className="absolute left-8 top-24 max-h-[80vh] w-96 overflow-y-auto rounded-xl border border-amber-800/40 bg-[#120e08]/95 p-5 text-amber-50 shadow-2xl"
      data-testid="decoration-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Modo edição</h2>
        <button type="button" onClick={onClose} className="text-amber-400/70 hover:text-amber-200" aria-label="Fechar">
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-amber-500/80">
        Tecla E fecha. Móveis grandes e paredes só entram se todos continuarem chegando às mesas, portas e lazer.
      </p>
      <label className="mt-4 block text-sm text-amber-600">
        Sala
        <select
          className="mt-1 w-full rounded bg-black/60 px-2 py-1 text-amber-50"
          value={activeZone}
          onChange={(event) => setZoneId(event.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone.id} value={zone.id}>
              {zone.label}
            </option>
          ))}
        </select>
      </label>

      <ul className="mt-3 space-y-1 text-sm" data-testid="decoration-items">
        {current.items.length === 0 && current.walls.length === 0 ? (
          <li className="text-amber-600/70">Sem decoração nesta sala.</li>
        ) : null}
        {current.items.map((item) => (
          <li key={`item-${item.slot}`} className="flex items-center justify-between rounded bg-black/40 px-2 py-1">
            <span>{ITEM_LABELS[item.type]}</span>
            <button
              type="button"
              className="text-amber-400/70 hover:text-red-300"
              onClick={() => commit({ ...current, items: current.items.filter((other) => other.slot !== item.slot) })}
              aria-label={`Remover ${ITEM_LABELS[item.type]}`}
            >
              ✕
            </button>
          </li>
        ))}
        {current.walls.map((w, index) => (
          <li key={`wall-${index}`} className="flex items-center justify-between rounded bg-black/40 px-2 py-1">
            <span>
              Parede {w.dir === "h" ? "horizontal" : "vertical"} · col {w.c}, lin {w.r}, {w.len} células
            </span>
            <button
              type="button"
              className="text-amber-400/70 hover:text-red-300"
              onClick={() => commit({ ...current, walls: current.walls.filter((_, i) => i !== index) })}
              aria-label="Remover parede"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-semibold text-amber-300">Decoração (passagem livre)</h3>
      <div className="mt-1 grid grid-cols-2 gap-1 text-sm">
        {(Object.keys(DECOR_TYPES) as ItemType[]).map((type) => (
          <button
            key={type}
            type="button"
            disabled={current.items.length >= DECOR_SLOTS}
            onClick={() => add(type)}
            className="rounded bg-amber-900/40 px-2 py-1 text-left hover:bg-amber-800/60 disabled:opacity-40"
          >
            + {ITEM_LABELS[type]}
          </button>
        ))}
      </div>

      <h3 className="mt-4 text-sm font-semibold text-amber-300">Móveis grandes</h3>
      <div className="mt-1 grid grid-cols-2 gap-1 text-sm">
        {(Object.keys(BLOCKING_TYPES) as ItemType[]).map((type) => (
          <button
            key={type}
            type="button"
            disabled={current.items.length >= DECOR_SLOTS}
            onClick={() => add(type)}
            className="rounded bg-orange-900/40 px-2 py-1 text-left hover:bg-orange-800/60 disabled:opacity-40"
          >
            + {ITEM_LABELS[type]}
          </button>
        ))}
      </div>

      <h3 className="mt-4 text-sm font-semibold text-amber-300">Parede interna</h3>
      <div className="mt-1 flex items-end gap-2">
        {numberField("c", "Coluna", 40)}
        {numberField("r", "Linha", 40)}
        {numberField("len", "Tamanho", 12)}
        <label className="flex flex-col text-xs text-amber-600">
          Direção
          <select
            value={wall.dir}
            onChange={(event) => setWall({ ...wall, dir: event.target.value === "v" ? "v" : "h" })}
            className="rounded bg-black/60 px-1 py-0.5 text-amber-50"
          >
            <option value="h">Horizontal</option>
            <option value="v">Vertical</option>
          </select>
        </label>
        <button
          type="button"
          disabled={current.walls.length >= MAX_WALLS}
          onClick={() => commit({ ...current, walls: [...current.walls, wall] })}
          className="rounded bg-orange-900/40 px-2 py-1 text-sm hover:bg-orange-800/60 disabled:opacity-40"
        >
          + Parede
        </button>
      </div>

      {refused ? (
        <p className="mt-3 text-sm text-red-300" data-testid="decoration-refused">
          {refused}
        </p>
      ) : null}
      {dropped.length > 0 ? (
        <p className="mt-3 text-xs text-amber-400">
          Móveis grandes/paredes ignorados agora para não bloquear passagem: {dropped.map(labelOf).join(", ")}.
        </p>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </aside>
  );
}
