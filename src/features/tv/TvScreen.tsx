"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDirectedTarget } from "@/features/retro-office/core/types";
import { RetroOffice3D } from "@/features/retro-office/RetroOffice3D";
import { toOfficeAgents, type AgentarioAgent } from "@/features/tv/agentarioAgents";
import { decorableZones, type Decoration } from "@/features/tv/decoration";
import { DecorationPanel, useDecoration } from "@/features/tv/DecorationPanel";
import { applyDemo } from "@/features/tv/demo";
import { buildLayout, buildSafeLayout, layoutIssues } from "@/features/tv/layout";
import { LEISURE_ROOMS } from "@/features/tv/layout/rooms";
import { assignTargets, layoutDemand } from "@/features/tv/movement";
import { configureSceneFonts } from "@/features/tv/sceneText";
import { TvEnvironment } from "@/features/tv/TvEnvironment";
import { useAgentarioFeed, type AgentarioFeedStatus } from "@/features/tv/useAgentarioFeed";
import { fitCamera, isNight } from "@/features/tv/view";

// Antes de qualquer texto 3D: fonte local (sem CDN).
configureSceneFonts();

const STATUS_LABELS: Record<AgentarioFeedStatus, string> = {
  connecting: "Conectando…",
  connected: "Ao vivo",
  disconnected: "Sem conexão com o adaptador",
  "wrong-adapter": "Adaptador errado: rode npm run tv",
};

const STATUS_COLORS: Record<AgentarioFeedStatus, string> = {
  connecting: "bg-amber-400",
  connected: "bg-emerald-400",
  disconnected: "bg-red-500",
  "wrong-adapter": "bg-red-500",
};

const CARD_TIMEOUT_MS = 15_000;
const DAILY_RELOAD_HOUR = 4;
const CONTEXT_LOST_RELOAD_MS = 5_000;

const KIND_LABELS: Record<AgentarioAgent["kind"], string> = {
  owner: "Deus Onipotente",
  session: "Claude",
  staff: "Funcionário",
  intern: "Estagiário",
  fiscal: "Fiscal Codex",
};

/** Cartão do personagem (clique na cena). A tarefa já vem filtrada pela política da sala. */
function AgentCard({ agent, onClose }: { agent: AgentarioAgent; onClose: () => void }) {
  const role =
    agent.kind === "staff" || agent.kind === "intern"
      ? `${KIND_LABELS[agent.kind]} · ${agent.role ?? ""}`
      : KIND_LABELS[agent.kind];
  return (
    <div
      className="absolute right-8 top-24 w-80 rounded-xl border border-amber-800/40 bg-[#120e08]/95 p-5 text-amber-50 shadow-2xl"
      data-testid="agent-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-semibold">{agent.name}</div>
          <div className="text-sm uppercase tracking-widest text-amber-500">{role}</div>
        </div>
        <button type="button" onClick={onClose} className="text-amber-400/70 hover:text-amber-200" aria-label="Fechar">
          ✕
        </button>
      </div>
      <dl className="mt-4 space-y-1 text-base">
        <div className="flex gap-2">
          <dt className="text-amber-600">Sala</dt>
          <dd>{agent.room ?? (agent.kind === "owner" ? "Centro" : "—")}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-amber-600">Estado</dt>
          <dd>{agent.status === "working" ? "Trabalhando" : "Parado"}</dd>
        </div>
        {agent.task ? (
          <div className="flex gap-2">
            <dt className="text-amber-600">Faz</dt>
            <dd>{agent.task}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

// Relógio isolado: o tique de cada segundo não re-renderiza a cena.
const Clock = memo(function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  if (!now) return null;
  return (
    <span className="font-mono text-2xl tabular-nums text-white/90">
      {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
});

/** Relógio da simulação (janelas de lazer e visitas). */
function useSimulationClock(stepMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
}

/**
 * Operação 24/7 na TV: recarrega a página se o contexto WebGL cair (GPU trocada, Mac
 * dormindo) e uma vez por dia de madrugada, para limpar qualquer vazamento acumulado.
 */
function useSelfHealing() {
  useEffect(() => {
    const loadedAt = Date.now();
    let reloadTimer: number | null = null;
    const scheduleReload = (delayMs: number) => {
      if (reloadTimer === null) reloadTimer = window.setTimeout(() => window.location.reload(), delayMs);
    };
    const onContextLost = (event: Event) => {
      if (event.target instanceof HTMLCanvasElement) scheduleReload(CONTEXT_LOST_RELOAD_MS);
    };
    document.addEventListener("webglcontextlost", onContextLost, true);
    const daily = window.setInterval(() => {
      const now = new Date();
      if (now.getHours() === DAILY_RELOAD_HOUR && Date.now() - loadedAt > 60 * 60 * 1000) scheduleReload(0);
    }, 60_000);
    return () => {
      document.removeEventListener("webglcontextlost", onContextLost, true);
      window.clearInterval(daily);
      if (reloadTimer !== null) window.clearTimeout(reloadTimer);
    };
  }, []);
}

function useViewport() {
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 });
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const first = window.setTimeout(update, 0);
    window.addEventListener("resize", update);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("resize", update);
    };
  }, []);
  return viewport;
}

/** Mantém a mesma referência enquanto o conteúdo não muda (evita reprocessar a cena). */
function useStableValue<T>(value: T): T {
  const key = JSON.stringify(value);
  return useMemo(() => JSON.parse(key) as T, [key]);
}

const zoneLabel = (zoneId: string | null, rooms: Array<{ id: string; label: string }>) =>
  !zoneId
    ? "corredor"
    : zoneId === "centro"
      ? "Sala do Friol"
      : (LEISURE_ROOMS.find((room) => `lazer:${room.id}` === zoneId)?.label ??
        rooms.find((room) => room.id === zoneId)?.label ??
        zoneId);

export function TvScreen() {
  const feed = useAgentarioFeed();
  const viewport = useViewport();
  useSelfHealing();
  const now = useSimulationClock(1000);
  const [demo, setDemo] = useState(false);
  const [selected, setSelected] = useState<{ id: string; at: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const decor = useDecoration();

  // ?demo=1 liga a demonstração (não fica salvo).
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).get("demo") === "1") setDemo(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      const typing = event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement;
      if ((event.key === "e" || event.key === "E") && !typing) setEditing((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Demo muda a cada minuto; o resto da cena só reage a mudanças reais.
  const demoWindow = Math.floor(now / 60_000);
  const view = useMemo(
    () => (demo ? applyDemo(feed.rooms, feed.agents, demoWindow * 60_000) : { rooms: feed.rooms, agents: feed.agents }),
    [demo, demoWindow, feed.rooms, feed.agents],
  );

  const demand = useStableValue(
    useMemo(() => {
      const raw = layoutDemand(view.agents);
      // Arredonda a espera em blocos de 10 para não refazer a planta a cada pessoa.
      return { ...raw, population: Math.ceil(raw.population / 10) * 10 };
    }, [view.agents]),
  );
  const layoutRooms = useStableValue(view.rooms);
  const safe = useMemo(
    () => buildSafeLayout(layoutRooms, demand, decor.decoration),
    [layoutRooms, demand, decor.decoration],
  );
  const layout = safe.layout;
  // A edição só é aceita se nada ficar inalcançável com as salas de agora.
  const validateDecoration = useCallback(
    (next: Decoration) => {
      const issues = layoutIssues(buildLayout(layoutRooms, demand, { decoration: next, blockingZones: "all" }));
      if (issues.length === 0) return null;
      return `Recusado: isso bloquearia a passagem (${zoneLabel(issues[0].zoneId, layoutRooms)}).`;
    },
    [layoutRooms, demand],
  );

  const movementNow = Math.floor(now / 5000) * 5000;
  const targets = useStableValue<Record<string, AgentDirectedTarget>>(
    useMemo(
      () =>
        assignTargets({
          layout,
          rooms: view.rooms,
          agents: view.agents,
          now: movementNow,
          demo,
          initialIds: feed.initialIds ?? undefined,
        }),
      [layout, view.rooms, view.agents, movementNow, demo, feed.initialIds],
    ),
  );
  const officeAgents = useMemo(() => toOfficeAgents(view.agents), [view.agents]);

  const camera = useMemo(() => fitCamera(layout.bounds, viewport), [layout.bounds, viewport]);
  const environment = useMemo(() => <TvEnvironment layout={layout} />, [layout]);

  const working = view.agents.filter((agent) => agent.status === "working").length;
  const litRooms = view.rooms.filter((room) => room.lit).length;
  const night = feed.config ? isNight(feed.config.night, new Date(now)) : false;
  const selectAgent = useCallback((id: string) => setSelected({ id, at: Date.now() }), []);
  const selectedAgent =
    selected && now - selected.at < CARD_TIMEOUT_MS
      ? (view.agents.find((agent) => agent.id === selected.id) ?? null)
      : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      <RetroOffice3D
        agents={officeAgents}
        readOnly
        storageNamespace="agentario-tv"
        officeTitle="Escritório"
        officeTitleLoaded
        furniture={layout.furniture}
        targetByAgentId={targets}
        cameraOverride={camera}
        customEnvironment={environment}
        onAgentChatSelect={selectAgent}
      />
      {selectedAgent ? <AgentCard agent={selectedAgent} onClose={() => setSelected(null)} /> : null}
      {editing ? (
        <DecorationPanel
          zones={decorableZones(layout)}
          decoration={decor.decoration}
          error={decor.error}
          dropped={safe.dropped}
          validate={validateDecoration}
          onChange={(next) => void decor.save(next)}
          onClose={() => setEditing(false)}
        />
      ) : null}
      {night ? (
        <div
          className="pointer-events-none absolute inset-0 bg-[#050a24]/45 mix-blend-multiply"
          data-testid="night-overlay"
        />
      ) : null}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-8 py-5">
        <button
          type="button"
          className="pointer-events-auto flex items-baseline gap-3 text-left"
          onClick={() => setDemo((value) => !value)}
          data-testid="logo"
        >
          <span className={`font-display text-4xl tracking-wide ${demo ? "text-amber-400" : "text-white"}`}>
            Agentário
          </span>
          {demo ? <span className="text-lg text-amber-300">modo demonstração</span> : null}
        </button>
        <div className="flex items-center gap-6 text-white/80">
          <span className="text-lg" data-testid="counts">
            {working} trabalhando · {litRooms} de {view.rooms.length} salas acesas
          </span>
          <span className="flex items-center gap-2 text-lg" data-testid="feed-status" data-status={feed.status}>
            <span className={`h-3 w-3 rounded-full ${STATUS_COLORS[feed.status]}`} />
            {STATUS_LABELS[feed.status]}
          </span>
          <Clock />
        </div>
      </header>
      <nav className="absolute bottom-3 right-4 flex gap-1 rounded-full bg-black/60 p-1 text-sm">
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          data-active={editing}
          data-testid="edit-toggle"
          className={`rounded-full px-3 py-1 ${editing ? "bg-amber-400 text-black" : "text-white/70"}`}
        >
          ✎ Editar
        </button>
      </nav>
    </main>
  );
}
