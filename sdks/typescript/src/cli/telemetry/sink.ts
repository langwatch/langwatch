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
  const connection = new IpcConnection(path);
  return {
    emit: (record) => connection.send(record),
    flush: () => connection.end(),
  };
};

/** One lazily opened socket and its queue. Any error or hangup stops it for good. */
class IpcConnection {
  private readonly path: string;
  private readonly pending: string[] = [];
  private socket: net.Socket | null = null;
  private connected = false;
  private broken = false;

  constructor(path: string) {
    this.path = path;
  }

  send(record: EventRecord): void {
    if (this.broken) return;
    this.connect();

    const line = `${JSON.stringify(record)}\n`;
    if (this.connected && this.socket) this.socket.write(line);
    else this.pending.push(line);
  }

  /**
   * The command is over, so the connection is too: `end()` flushes what's
   * buffered then sends FIN. A socket still mid-connect gets a moment first,
   * but never more: the timer is unref'd and bounded.
   */
  async end(): Promise<void> {
    if (this.broken || !this.socket) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, IPC_DRAIN_MS);
      timer.unref?.();

      const finish = (): void => {
        clearTimeout(timer);
        this.socket?.end(() => resolve());
      };

      if (this.connected) finish();
      else this.socket?.once("connect", finish);
    });
  }

  private connect(): void {
    if (this.socket || this.broken) return;

    const socket = net.createConnection({ path: this.path });
    this.socket = socket;
    // A telemetry socket must never hold the CLI open: if it is the only
    // handle left, the process exits and the tail is dropped.
    socket.unref();
    socket.on("connect", () => this.drain());
    socket.on("error", () => this.abandon());
    socket.on("close", () => this.abandon());
  }

  private drain(): void {
    this.connected = true;
    for (const line of this.pending.splice(0)) this.socket?.write(line);
  }

  private abandon(): void {
    this.broken = true;
    this.connected = false;
    this.pending.length = 0;
    this.socket?.destroy();
    this.socket = null;
  }
}

/** The longest a flush will wait for an unconnected IPC socket. */
const IPC_DRAIN_MS = 250;
