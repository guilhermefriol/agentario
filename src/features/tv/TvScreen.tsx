"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { AgentDirectedTarget } from "@/features/retro-office/core/types";
import { RetroOffice3D } from "@/features/retro-office/RetroOffice3D";
import { toOfficeAgents, type AgentarioAgent } from "@/features/tv/agentarioAgents";
import { decorableZones, type Decoration } from "@/features/tv/decoration";
import { DecorationPanel, useDecoration } from "@/features/tv/DecorationPanel";
import { applyDemo } from "@/features/tv/demo";
import {
  flatScene,
  planFloorScene,
  type FloorScene,
  type FloorTransitState,
} from "@/features/tv/floorTransit";
import type { Layout } from "@/features/tv/layout";
import {
  buildLayout,
  buildSafeLayout,
  layoutIssues,
  LAYOUT_KINDS,
  type LayoutKind,
} from "@/features/tv/layout";
import { LEISURE_ROOMS } from "@/features/tv/layout/rooms";
import { assignTargets, layoutDemand } from "@/features/tv/movement";
import { TvEnvironment } from "@/features/tv/TvEnvironment";
import { useAgentarioFeed, type AgentarioFeedStatus } from "@/features/tv/useAgentarioFeed";
import { fitCamera, isNight } from "@/features/tv/view";

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

const LAYOUT_LABELS: Record<LayoutKind, string> = {
  acesas: "Só acesas",
  baias: "Baias",
  andares: "Andares",
};

const LAYOUT_STORAGE_KEY = "agentario.layout";
const CARD_TIMEOUT_MS = 15_000;

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
const FLOOR_CYCLE_MS = 20_000;

const readStoredLayout = (): LayoutKind | null => {
  try {
    const value = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    return LAYOUT_KINDS.includes(value as LayoutKind) ? (value as LayoutKind) : null;
  } catch {
    return null;
  }
};

const storeLayout = (kind: LayoutKind) => {
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, kind);
  } catch {
    // Sem armazenamento (janela privada etc.): a escolha vale só nesta sessão.
  }
};

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

/** Relógio da simulação (janelas de lazer, visitas e trânsito no elevador). */
function useSimulationClock(stepMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(id);
  }, [stepMs]);
  return now;
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

/**
 * Andares: o trânsito no elevador depende do estado anterior, então avança fora do render
 * (num timer) a partir dos alvos atuais. Fora de "andares" a cena é imediata.
 */
function useFloorScene(
  layout: Layout,
  targets: Record<string, AgentDirectedTarget>,
  now: number,
): FloorScene {
  const [floors, setFloors] = useState<{ scene: FloorScene; state: FloorTransitState }>(() => ({
    scene: { targets: {}, agentOf: {} },
    state: {},
  }));
  useEffect(() => {
    if (layout.kind !== "andares") return;
    const timer = window.setTimeout(() => {
      setFloors((previous) => planFloorScene(layout, targets, previous.state, now));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [layout, targets, now]);
  return layout.kind === "andares" ? floors.scene : flatScene(targets);
}

export function TvScreen() {
  const feed = useAgentarioFeed();
  const viewport = useViewport();
  const now = useSimulationClock(1000);
  const [demo, setDemo] = useState(false);
  const [layoutChoice, setLayoutChoice] = useState<LayoutKind | null>(null);
  const [selected, setSelected] = useState<{ id: string; at: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const decor = useDecoration();

  // URL (?demo=1, ?layout=) e escolha salva neste navegador, depois de montar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("layout");
    const timer = window.setTimeout(() => {
      if (params.get("demo") === "1") setDemo(true);
      if (LAYOUT_KINDS.includes(fromUrl as LayoutKind)) setLayoutChoice(fromUrl as LayoutKind);
      else setLayoutChoice(readStoredLayout());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const layoutKind: LayoutKind = layoutChoice ?? feed.config?.layout ?? "acesas";
  const chooseLayout = useCallback((kind: LayoutKind) => {
    setLayoutChoice(kind);
    storeLayout(kind);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const index = ["1", "2", "3"].indexOf(event.key);
      if (index >= 0) chooseLayout(LAYOUT_KINDS[index]);
      if (event.key === "Escape") setSelected(null);
      if ((event.key === "e" || event.key === "E") && !(event.target instanceof HTMLSelectElement)) {
        setEditing((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseLayout]);

  // Demo muda a cada minuto; o resto da cena só reage a mudanças reais.
  const demoWindow = Math.floor(now / 60_000);
  const view = useMemo(
    () => (demo ? applyDemo(feed.rooms, feed.agents, demoWindow * 60_000) : { rooms: feed.rooms, agents: feed.agents }),
    [demo, demoWindow, feed.rooms, feed.agents],
  );

  const demand = useStableValue(useMemo(() => {
    const raw = layoutDemand(view.agents);
    // Arredonda a espera em blocos de 10 para não refazer a planta a cada pessoa.
    return { ...raw, population: Math.ceil(raw.population / 10) * 10 };
  }, [view.agents]));
  const layoutRooms = useStableValue(view.rooms);
  const safe = useMemo(
    () => buildSafeLayout(layoutKind, layoutRooms, demand, decor.decoration),
    [layoutKind, layoutRooms, demand, decor.decoration],
  );
  const layout = safe.layout;
  // A edição só é aceita se nenhum dos 3 layouts (com as salas de agora) ficar com algo inalcançável.
  const validateDecoration = useCallback(
    (next: Decoration) => {
      for (const kind of LAYOUT_KINDS) {
        const issues = layoutIssues(buildLayout(kind, layoutRooms, demand, { decoration: next, blockingZones: "all" }));
        if (issues.length > 0) {
          const zone = issues[0].zoneId;
          const label = !zone
            ? "corredor"
            : zone === "centro"
              ? "Sala do Friol"
              : (LEISURE_ROOMS.find((room) => `lazer:${room.id}` === zone)?.label ??
                layoutRooms.find((room) => room.id === zone)?.label ??
                zone);
          return `Recusado: no layout "${LAYOUT_LABELS[kind]}" isso bloquearia a passagem (${label}).`;
        }
      }
      return null;
    },
    [layoutRooms, demand],
  );

  const movementNow = Math.floor(now / 5000) * 5000;
  const targets = useMemo(
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
  );
  const scene = useStableValue(useFloorScene(layout, targets, now));
  const sceneTargets = useStableValue<Record<string, AgentDirectedTarget>>(scene.targets);

  const officeAgents = useMemo(() => {
    const byId = new Map(toOfficeAgents(view.agents).map((agent) => [agent.id, agent]));
    return Object.entries(scene.agentOf).flatMap(([sceneId, agentId]) => {
      const agent = byId.get(agentId);
      return agent ? [{ ...agent, id: sceneId }] : [];
    });
  }, [scene.agentOf, view.agents]);

  // Andares: mostra um andar por vez, priorizando os que têm sala acesa, e o terraço.
  const floorCycle = Math.floor(now / FLOOR_CYCLE_MS);
  const shownPlan = useMemo(() => {
    if (layout.kind !== "andares" || layout.floorPlans.length === 0) return null;
    const litFloors = new Set(layout.zones.filter((z) => z.kind === "project" && z.lit).map((z) => z.floor));
    const terrace = layout.floorPlans[layout.floorPlans.length - 1];
    const candidates = [...layout.floorPlans.filter((plan) => litFloors.has(plan.floor)), terrace];
    return candidates[floorCycle % candidates.length];
  }, [layout, floorCycle]);

  const sceneAgents = useMemo(
    () =>
      shownPlan
        ? officeAgents.filter((agent) => agent.id.endsWith(`@${shownPlan.floor}`))
        : officeAgents,
    [officeAgents, shownPlan],
  );
  const shownTargets = useMemo(() => {
    if (!shownPlan) return sceneTargets;
    const filtered: Record<string, AgentDirectedTarget> = {};
    for (const agent of sceneAgents) {
      const target = sceneTargets[agent.id];
      if (target) filtered[agent.id] = target;
    }
    return filtered;
  }, [sceneTargets, sceneAgents, shownPlan]);

  const shownZones = shownPlan ? shownPlan.zones : layout.zones;
  const furniture = shownPlan ? shownPlan.furniture : layout.furniture;

  const camera = useMemo(
    () => fitCamera(shownPlan ? shownPlan.bounds : layout.bounds, viewport),
    [layout.bounds, shownPlan, viewport],
  );
  const environment = useMemo(
    () => <TvEnvironment layout={layout} plan={shownPlan} />,
    [layout, shownPlan],
  );

  const working = view.agents.filter((agent) => agent.status === "working").length;
  const litRooms = view.rooms.filter((room) => room.lit).length;
  const hiddenLabels = layout.hiddenRooms
    .map((id) => view.rooms.find((room) => room.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  const night = feed.config ? isNight(feed.config.night, new Date(now)) : false;
  const selectAgent = useCallback(
    (sceneId: string) => setSelected({ id: scene.agentOf[sceneId] ?? sceneId, at: Date.now() }),
    [scene.agentOf],
  );
  const selectedAgent =
    selected && now - selected.at < CARD_TIMEOUT_MS
      ? (view.agents.find((agent) => agent.id === selected.id) ?? null)
      : null;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      <RetroOffice3D
        agents={sceneAgents}
        readOnly
        storageNamespace="agentario-tv"
        officeTitle={shownPlan ? shownPlan.label : "Escritório"}
        officeTitleLoaded
        furniture={furniture}
        targetByAgentId={shownTargets}
        cameraOverride={camera}
        customEnvironment={environment}
        onAgentChatSelect={selectAgent}
      />
      {selectedAgent ? <AgentCard agent={selectedAgent} onClose={() => setSelected(null)} /> : null}
      {editing ? (
        <DecorationPanel
          zones={decorableZones(layout, shownZones)}
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
      {hiddenLabels.length > 0 ? (
        <footer
          className="pointer-events-none absolute inset-x-0 bottom-12 truncate px-8 text-center text-base text-white/45"
          data-testid="dark-rooms"
        >
          Apagadas ({hiddenLabels.length}): {hiddenLabels.join(" · ")}
        </footer>
      ) : null}
      <nav className="absolute bottom-3 right-4 flex gap-1 rounded-full bg-black/60 p-1 text-sm" data-testid="layout-switch">
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          data-active={editing}
          className={`rounded-full px-3 py-1 ${editing ? "bg-amber-400 text-black" : "text-white/70"}`}
        >
          ✎ Editar
        </button>
        {LAYOUT_KINDS.map((kind, index) => (
          <button
            key={kind}
            type="button"
            onClick={() => chooseLayout(kind)}
            data-active={kind === layoutKind}
            className={`rounded-full px-3 py-1 ${kind === layoutKind ? "bg-white/90 text-black" : "text-white/70"}`}
          >
            {index + 1} · {LAYOUT_LABELS[kind]}
          </button>
        ))}
      </nav>
    </main>
  );
}

export type { AgentarioAgent };
