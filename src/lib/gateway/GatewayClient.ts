"use client";

import { GatewayBrowserClient, type GatewayHelloOk } from "./openclaw/GatewayBrowserClient";
import { GatewayResponseError } from "@/lib/gateway/errors";

// Cliente do protocolo de gateway (WebSocket req/res/event). No Agentário fala com o
// adaptador somente leitura do Claude Code; a UI antiga de conexão do OpenClaw foi removida.

export type ReqFrame = {
  type: "req";
  id: string;
  method: string;
  params: unknown;
};

export type ResFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
    retryable?: boolean;
    retryAfterMs?: number;
  };
};

export type GatewayStateVersion = {
  presence: number;
  health: number;
};

export type EventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: GatewayStateVersion;
};

export type GatewayFrame = ReqFrame | ResFrame | EventFrame;

export const parseGatewayFrame = (raw: string): GatewayFrame | null => {
  try {
    return JSON.parse(raw) as GatewayFrame;
  } catch {
    return null;
  }
};

export const buildAgentMainSessionKey = (agentId: string, mainKey: string) => {
  const trimmedAgent = agentId.trim();
  const trimmedKey = mainKey.trim() || "main";
  return `agent:${trimmedAgent}:${trimmedKey}`;
};

export const parseAgentIdFromSessionKey = (sessionKey: string): string | null => {
  const match = sessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : null;
};

export const isSameSessionKey = (a: string, b: string) => {
  const left = a.trim();
  const right = b.trim();
  return left.length > 0 && left === right;
};

const CONNECT_FAILED_CLOSE_CODE = 4008;
const GATEWAY_CONNECT_TIMEOUT_MS = 13_000;

const parseConnectFailedCloseReason = (
  reason: string
): { code: string; message: string } | null => {
  const trimmed = reason.trim();
  if (!trimmed.toLowerCase().startsWith("connect failed:")) return null;
  const remainder = trimmed.slice("connect failed:".length).trim();
  if (!remainder) return null;
  const idx = remainder.indexOf(" ");
  const code = (idx === -1 ? remainder : remainder.slice(0, idx)).trim();
  if (!code) return null;
  const message = (idx === -1 ? "" : remainder.slice(idx + 1)).trim();
  return { code, message: message || "connect failed" };
};


type StatusHandler = (status: GatewayStatus) => void;

type EventHandler = (event: EventFrame) => void;

export type GatewayGapInfo = { expected: number; received: number };

type GapHandler = (info: GatewayGapInfo) => void;

export type GatewayStatus = "disconnected" | "connecting" | "connected";

export type GatewayConnectOptions = {
  gatewayUrl: string;
  token?: string;
  authScopeKey?: string;
  clientName?: string;
  disableDeviceAuth?: boolean;
};

export { GatewayResponseError } from "@/lib/gateway/errors";
export type { GatewayErrorPayload } from "@/lib/gateway/errors";

export class GatewayClient {
  private client: GatewayBrowserClient | null = null;
  private statusHandlers = new Set<StatusHandler>();
  private eventHandlers = new Set<EventHandler>();
  private gapHandlers = new Set<GapHandler>();
  private status: GatewayStatus = "disconnected";
  private pendingConnect: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private manualDisconnect = false;
  private lastHello: GatewayHelloOk | null = null;
  private _lastDisconnectCode: number | null = null;

  onStatus(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  onEvent(handler: EventHandler) {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  onGap(handler: GapHandler) {
    this.gapHandlers.add(handler);
    return () => {
      this.gapHandlers.delete(handler);
    };
  }

  async connect(options: GatewayConnectOptions) {
    if (!options.gatewayUrl.trim()) {
      throw new Error("Gateway URL is required.");
    }
    if (this.client) {
      throw new Error("Gateway is already connected or connecting.");
    }

    this.manualDisconnect = false;
    this.updateStatus("connecting");

    this.pendingConnect = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });

    const nextClient = new GatewayBrowserClient({
      url: options.gatewayUrl,
      token: options.token,
      authScopeKey: options.authScopeKey,
      clientName: options.clientName,
      disableDeviceAuth: options.disableDeviceAuth,
      onHello: (hello) => {
        if (this.client !== nextClient) return;
        this.lastHello = hello;
        this.updateStatus("connected");
        this.resolveConnect?.();
        this.clearConnectPromise();
      },
      onEvent: (event) => {
        if (this.client !== nextClient) return;
        this.eventHandlers.forEach((handler) => handler(event));
      },
      onClose: ({ code, reason }) => {
        if (this.client !== nextClient) return;
        this._lastDisconnectCode = code;
        const connectFailed =
          code === CONNECT_FAILED_CLOSE_CODE ? parseConnectFailedCloseReason(reason) : null;
        const err = connectFailed
          ? new GatewayResponseError({
              code: connectFailed.code,
              message: connectFailed.message,
            })
          : new Error(`Gateway closed (${code}): ${reason}`);
        if (this.rejectConnect) {
          this.rejectConnect(err);
          this.clearConnectPromise();
        }
        if (!this.manualDisconnect) {
          nextClient.stop();
        }
        if (this.client === nextClient) {
          this.client = null;
        }
        this.updateStatus("disconnected");
        if (this.manualDisconnect) {
          console.info("Gateway disconnected.");
        }
      },
      onGap: ({ expected, received }) => {
        if (this.client !== nextClient) return;
        this.gapHandlers.forEach((handler) => handler({ expected, received }));
      },
    });

    this.client = nextClient;
    nextClient.start();

    let connectTimeoutId: number | null = null;
    try {
      await Promise.race([
        this.pendingConnect,
        new Promise<never>((_, reject) => {
          connectTimeoutId = window.setTimeout(() => {
            reject(
              new Error(
                "Timed out connecting to the gateway. Check that it is running, or change the gateway address and try again."
              )
            );
          }, GATEWAY_CONNECT_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      const activeClient = this.client;
      this.clearConnectPromise();
      activeClient?.stop();
      if (this.client === activeClient) {
        this.client = null;
      }
      this.updateStatus("disconnected");
      throw err;
    } finally {
      if (connectTimeoutId !== null) {
        window.clearTimeout(connectTimeoutId);
      }
    }
  }

  disconnect() {
    if (!this.client) {
      return;
    }

    this.manualDisconnect = true;
    this.client.stop();
    this.client = null;
    this.clearConnectPromise();
    this.updateStatus("disconnected");
    console.info("Gateway disconnected.");
  }

  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    if (!method.trim()) {
      throw new Error("Gateway method is required.");
    }
    if (!this.client || !this.client.connected) {
      throw new Error("Gateway is not connected.");
    }

    const payload = await this.client.request<T>(method, params);
    return payload as T;
  }

  getLastHello() {
    return this.lastHello;
  }

  get lastDisconnectCode() {
    return this._lastDisconnectCode;
  }

  private updateStatus(status: GatewayStatus) {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }

  private clearConnectPromise() {
    this.pendingConnect = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
  }
}
