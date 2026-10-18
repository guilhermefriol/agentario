"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DECOR_SLOTS,
  DECOR_TYPES,
  EMPTY_DECORATION,
  normalizeDecoration,
  type Decoration,
  type DecorType,
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
  onChange: (next: Decoration) => void;
  onClose: () => void;
};

/** Painel do modo edição: escolher a sala, adicionar e remover itens de decoração. */
export function DecorationPanel({ zones, decoration, error, onChange, onClose }: Props) {
  const [zoneId, setZoneId] = useState<string>(zones[0]?.id ?? "");
  const activeZone = zones.some((zone) => zone.id === zoneId) ? zoneId : (zones[0]?.id ?? "");
  const items = decoration.zones[activeZone] ?? [];

  const update = (nextItems: Decoration["zones"][string]) => {
    const zonesNext = { ...decoration.zones };
    if (nextItems.length > 0) zonesNext[activeZone] = nextItems;
    else delete zonesNext[activeZone];
    onChange({ version: 1, zones: zonesNext });
  };
  const add = (type: DecorType) => {
    const used = new Set(items.map((item) => item.slot));
    const slot = Array.from({ length: DECOR_SLOTS }, (_, i) => i).find((i) => !used.has(i));
    if (slot === undefined) return;
    update([...items, { type, slot }]);
  };

  return (
    <aside
      className="absolute left-8 top-24 w-80 rounded-xl border border-amber-800/40 bg-[#120e08]/95 p-5 text-amber-50 shadow-2xl"
      data-testid="decoration-panel"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Modo edição</h2>
        <button type="button" onClick={onClose} className="text-amber-400/70 hover:text-amber-200" aria-label="Fechar">
          ✕
        </button>
      </div>
      <p className="mt-1 text-xs text-amber-500/80">Decoração que não bloqueia a passagem. Tecla E fecha.</p>
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
        {items.length === 0 ? <li className="text-amber-600/70">Sem decoração nesta sala.</li> : null}
        {items.map((item) => (
          <li key={item.slot} className="flex items-center justify-between rounded bg-black/40 px-2 py-1">
            <span>{DECOR_TYPES[item.type]}</span>
            <button
              type="button"
              className="text-amber-400/70 hover:text-red-300"
              onClick={() => update(items.filter((other) => other.slot !== item.slot))}
              aria-label={`Remover ${DECOR_TYPES[item.type]}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-2 gap-1 text-sm">
        {(Object.keys(DECOR_TYPES) as DecorType[]).map((type) => (
          <button
            key={type}
            type="button"
            disabled={items.length >= DECOR_SLOTS}
            onClick={() => add(type)}
            className="rounded bg-amber-900/40 px-2 py-1 text-left hover:bg-amber-800/60 disabled:opacity-40"
          >
            + {DECOR_TYPES[type]}
          </button>
        ))}
      </div>
      {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
    </aside>
  );
}
