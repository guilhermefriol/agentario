"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { RetroOffice3D } from "@/features/retro-office/RetroOffice3D";
import { toOfficeAgents } from "@/features/tv/agentarioAgents";
import { useAgentarioFeed, type AgentarioFeedStatus } from "@/features/tv/useAgentarioFeed";

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

export function TvScreen() {
  const { status, agents } = useAgentarioFeed();
  const officeAgents = useMemo(() => toOfficeAgents(agents), [agents]);
  const working = agents.filter((agent) => agent.status === "working").length;

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black">
      <RetroOffice3D
        agents={officeAgents}
        readOnly
        storageNamespace="agentario-tv"
        officeTitle="Escritório"
        officeTitleLoaded
      />
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent px-8 py-5">
        <span className="font-display text-4xl tracking-wide text-white">Agentário</span>
        <div className="flex items-center gap-6 text-white/80">
          <span className="text-lg">
            {working} trabalhando · {agents.length} no escritório
          </span>
          <span className="flex items-center gap-2 text-lg" data-testid="feed-status" data-status={status}>
            <span className={`h-3 w-3 rounded-full ${STATUS_COLORS[status]}`} />
            {STATUS_LABELS[status]}
          </span>
          <Clock />
        </div>
      </header>
    </main>
  );
}
