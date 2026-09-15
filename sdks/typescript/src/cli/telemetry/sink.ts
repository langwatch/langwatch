/**
 * Where a live CLI event actually goes, kept behind an interface since the
 * wire is the part most likely to change. Two sinks: IPC (cheap, no SDK,
 * enabled just by the host handing us a socket) and OTLP logs (crosses a
 * process boundary, pays a ~60ms SDK load). IPC wins when both are
 * configured — strictly cheaper and faster, and the listening host wants it.
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
