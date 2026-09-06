/**
 * The reconnect loop both LangWatch sockets run on.
 *
 * The connected-agents client (`client.ts`) and the local control client
 * (`cli/commands/langy/relay-client.ts`) open different sockets and speak
 * different frames, but they keep them alive the same way: open, register,
 * watch for a heartbeat, and come back with a jittered backoff when the
 * platform goes away. That part lives here so there is one implementation of
 * it rather than two that drift.
 */

import {
  type AgentTransport,
  defaultSocketFactory,
  HttpLongPollSocket,
  NoWebSocketError,
  type SocketFactory,
  type SocketLike,
} from "./transport";

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** The delay before reconnect attempt `attempt` (0-based), with jitter, in the 1 s to 30 s window. */
export function reconnectDelayMs({
  attempt,
  baseMs = RECONNECT_BASE_MS,
  maxMs = RECONNECT_MAX_MS,
  random = Math.random,
}: {
  attempt: number;
  baseMs?: number;
  maxMs?: number;
  random?: () => number;
}): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 16));
  const jittered = exponential * (0.75 + random() * 0.5);
  return Math.round(Math.min(maxMs, Math.max(baseMs, jittered)));
}

/**
 * How long the client waits for a sign of life before it drops the socket:
 * three heartbeats, and never less than fifteen seconds.
 */
export function watchdogDelayMs(heartbeatIntervalMs: number): number {
  return Math.max(15_000, heartbeatIntervalMs * 3);
}

export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** How a socket is opened for a transport, so the caller never repeats the branch. */
export function openTransportSocket({
  transport,
  websocketUrl,
  httpUrl,
  headers,
  socketFactory = defaultSocketFactory,
}: {
  transport: AgentTransport;
  websocketUrl: string;
  httpUrl: string;
  headers: Record<string, string>;
  socketFactory?: SocketFactory;
}): SocketLike {
  return transport === "http"
    ? new HttpLongPollSocket({ url: httpUrl, headers })
    : socketFactory({ url: websocketUrl, headers });
}

export { NoWebSocketError };
