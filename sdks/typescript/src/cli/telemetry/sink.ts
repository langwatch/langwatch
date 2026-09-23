/**
 * Where a live CLI event goes, behind an interface since the wire is most
 * likely to change. Two sinks: IPC (cheap, no SDK) and OTLP logs (~60ms SDK
 * load). IPC wins when both are configured -- cheaper and faster.
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
 * NDJSON down a unix socket. Connection is lazy and optimistic: records
 * queue until the socket is up, then drain in order. An unanswering or
 * hung-up host just drops them -- not an error the user's command hears about.
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

      // The command is over, so the connection is too: `end()` flushes what's
      // buffered then sends FIN, telling the host this run finished.

      // A socket still mid-connect gets a moment first, but never more: the
      // timer is unref'd and bounded, so a gone host cannot delay the command.
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
