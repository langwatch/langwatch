/**
 * Where a live CLI event actually goes.
 *
 * The valuable, hard-won part of this feature is knowing WHERE in a command to
 * emit and WHAT to say — the call sites and the vocabulary. The wire is an
 * implementation detail, and it is the part most likely to change, so it sits
 * behind this interface and nothing upstream of it knows which one is in use.
 *
 * Two sinks exist today:
 *
 *   - IPC (`LANGWATCH_EVENTS_SOCKET`) — newline-delimited JSON straight down a
 *     unix socket the host is already listening on. Costs nothing to load (node
 *     builtins only), delivers in microseconds, and needs no collector. When the
 *     host hands us a socket it is saying "I am listening", so its presence IS
 *     the enablement — no flag required.
 *
 *   - OTLP logs (`LANGWATCH_OTEL_EVENTS` + an OTLP endpoint) — the standard,
 *     collector-shaped path. Works across a process/container boundary the socket
 *     cannot cross, and lands in the ingestion the platform already runs. Pays a
 *     ~60ms SDK load, which is why it is deferred behind the gate.
 *
 * IPC wins when both are configured: it is strictly cheaper and strictly faster,
 * and if the host is listening on a socket it is the host that wants the events.
 */

import net from "node:net";
import type { LangWatchEvent } from "./attributes";

/** One beat of a command's life cycle, in transport-neutral form. */
export interface EventRecord {
  event: LangWatchEvent;
  /** The human line for the status row. */
  message: string;
  /** The full attribute set, already using the published vocabulary. */
  attributes: Record<string, string | number | boolean>;
  severity: "info" | "error";
  timestampMs: number;
}

export interface EventSink {
  /** Fire-and-forget. Must never throw and never block. */
  emit: (record: EventRecord) => void;
  /** Push anything buffered. Must resolve even if the far end is dead. */
  flush: () => Promise<void>;
}

/**
 * NDJSON down a unix socket.
 *
 * Connection is lazy and optimistic: records queue in memory until the socket is
 * up, then drain in order. If the host never answers, or hangs up, the records
 * are simply dropped — a telemetry channel losing frames is not an error the
 * user's command should ever hear about.
 */
export const createIpcSink = ({ path }: { path: string }): EventSink => {
  const pending: string[] = [];
  let socket: net.Socket | null = null;
  let connected = false;
  let broken = false;

  const connect = (): void => {
    if (socket || broken) return;

    socket = net.createConnection({ path });
    // A telemetry socket must never hold the CLI open. If the command is done and
    // this is the only handle left, the process exits and the tail is dropped —
    // which is the correct trade: the user's command is not hostage to a listener.
    socket.unref();

    socket.on("connect", () => {
      connected = true;
      for (const line of pending.splice(0)) socket?.write(line);
    });

    const abandon = (): void => {
      broken = true;
      connected = false;
      pending.length = 0;
      socket?.destroy();
      socket = null;
    };

    socket.on("error", abandon);
    socket.on("close", abandon);
  };

  return {
    emit: (record) => {
      if (broken) return;
      connect();

      const line = `${JSON.stringify(record)}\n`;
      if (connected && socket) socket.write(line);
      else pending.push(line);
    },

    flush: async () => {
      if (broken || !socket) return;

      // The command is over, so the connection is too: `end()` flushes whatever is
      // buffered and then sends FIN, which is what tells the host this run is
      // finished rather than merely quiet.
      //
      // A socket still mid-connect gets a moment to come up first, but never more:
      // the timer is unref'd and bounded, so a host that went away cannot delay the
      // user's command by a single tick beyond it.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, IPC_DRAIN_MS);
        timer.unref?.();

        const finish = (): void => {
          clearTimeout(timer);
          socket?.end(() => resolve());
        };

        if (connected) finish();
        else socket?.once("connect", finish);
      });
    },
  };
};

/** The longest a flush will wait for an unconnected IPC socket. */
const IPC_DRAIN_MS = 250;
