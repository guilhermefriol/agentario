"use client";

import { useEffect, useState } from "react";
import { GatewayClient } from "@/lib/gateway/GatewayClient";
import {
  isAgentarioHello,
  parseAgentarioAgents,
  sameAgents,
  type AgentarioAgent,
} from "@/features/tv/agentarioAgents";

export const DEFAULT_ADAPTER_URL =
  process.env.NEXT_PUBLIC_AGENTARIO_ADAPTER_URL?.trim() || "ws://localhost:18790";

const REFRESH_DEBOUNCE_MS = 500;
const SAFETY_REFRESH_MS = 15_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export type AgentarioFeedStatus = "connecting" | "connected" | "disconnected" | "wrong-adapter";

export type AgentarioFeed = {
  status: AgentarioFeedStatus;
  agents: AgentarioAgent[];
};

/**
 * Conecta no adaptador do Agentário e mantém a lista de personagens.
 * Uma geração por conexão: respostas de conexões antigas são descartadas.
 */
export function useAgentarioFeed(url: string = DEFAULT_ADAPTER_URL): AgentarioFeed {
  const [status, setStatus] = useState<AgentarioFeedStatus>("connecting");
  const [agents, setAgents] = useState<AgentarioAgent[]>([]);

  useEffect(() => {
    let disposed = false;
    let generation = 0;
    let client: GatewayClient | null = null;
    let unsubscribers: Array<() => void> = [];
    let backoffMs = BACKOFF_MIN_MS;
    let reconnectTimer: number | null = null;
    let debounceTimer: number | null = null;
    let safetyTimer: number | null = null;
    let fetching = false;
    let refreshPending = false;

    const clearTimers = () => {
      for (const timer of [reconnectTimer, debounceTimer, safetyTimer]) {
        if (timer !== null) window.clearTimeout(timer);
      }
      reconnectTimer = debounceTimer = safetyTimer = null;
    };

    const teardownClient = () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      unsubscribers = [];
      client?.disconnect();
      client = null;
    };

    const refresh = async (gen: number) => {
      if (disposed || gen !== generation || !client) return;
      if (fetching) {
        refreshPending = true;
        return;
      }
      fetching = true;
      try {
        const payload = await client.call("agents.list", {});
        if (disposed || gen !== generation) return;
        const next = parseAgentarioAgents(payload);
        setAgents((previous) => (sameAgents(previous, next) ? previous : next));
      } catch {
        // A queda da conexão é tratada pelo onStatus; aqui só esperamos a próxima tentativa.
      } finally {
        fetching = false;
        if (refreshPending && !disposed && gen === generation) {
          refreshPending = false;
          void refresh(gen);
        }
      }
    };

    const scheduleRefresh = (gen: number) => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void refresh(gen);
      }, REFRESH_DEBOUNCE_MS);
    };

    const scheduleSafetyRefresh = (gen: number) => {
      safetyTimer = window.setTimeout(() => {
        if (disposed || gen !== generation) return;
        void refresh(gen);
        scheduleSafetyRefresh(gen);
      }, SAFETY_REFRESH_MS);
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    };

    const connect = async () => {
      if (disposed) return;
      clearTimers();
      teardownClient();
      const gen = ++generation;
      const nextClient = new GatewayClient();
      client = nextClient;
      setStatus("connecting");

      unsubscribers.push(
        nextClient.onEvent((event) => {
          if (gen !== generation) return;
          if (event.event === "presence" || event.event === "chat") scheduleRefresh(gen);
        }),
      );

      try {
        await nextClient.connect({ gatewayUrl: url, disableDeviceAuth: true, clientName: "agentario-tv" });
      } catch {
        if (gen !== generation) return;
        setStatus("disconnected");
        scheduleReconnect();
        return;
      }
      if (disposed || gen !== generation) return;

      if (!isAgentarioHello(nextClient.getLastHello())) {
        teardownClient();
        setStatus("wrong-adapter");
        return;
      }

      backoffMs = BACKOFF_MIN_MS;
      setStatus("connected");
      unsubscribers.push(
        nextClient.onStatus((next) => {
          if (gen !== generation || next !== "disconnected" || disposed) return;
          setStatus("disconnected");
          scheduleReconnect();
        }),
      );
      void refresh(gen);
      scheduleSafetyRefresh(gen);
    };

    void connect();

    return () => {
      disposed = true;
      generation += 1;
      clearTimers();
      teardownClient();
    };
  }, [url]);

  return { status, agents };
}
