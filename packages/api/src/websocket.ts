import { WebSocket, WebSocketServer } from "ws";
import type { z } from "zod";
import type { ConnectUpgradeRouter } from "./ports.ts";

export interface ProtocolConnection {
  readonly open: boolean;
  onMessage(handler: (message: string) => void): () => void;
  onClose(handler: () => void): () => void;
  onPong(handler: () => void): () => void;
  onError(handler: (error: Error) => void): () => void;
  send(message: string): boolean;
  ping(): void;
  close(code: number, reason: string): void;
  terminate(): void;
}

class WebSocketConnection implements ProtocolConnection {
  readonly #socket: WebSocket;

  constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  get open(): boolean {
    return this.#socket.readyState === WebSocket.OPEN;
  }

  onMessage(handler: (message: string) => void): () => void {
    const receive = (data: WebSocket.RawData) => {
      let bytes: Buffer;

      if (Array.isArray(data)) bytes = Buffer.concat(data);
      else if (data instanceof ArrayBuffer) bytes = Buffer.from(data);
      else bytes = data;

      handler(bytes.toString("utf8"));
    };

    this.#socket.on("message", receive);

    return () => {
      this.#socket.off("message", receive);
    };
  }

  onClose(handler: () => void): () => void {
    this.#socket.on("close", handler);

    return () => {
      this.#socket.off("close", handler);
    };
  }

  onPong(handler: () => void): () => void {
    this.#socket.on("pong", handler);

    return () => {
      this.#socket.off("pong", handler);
    };
  }

  onError(handler: (error: Error) => void): () => void {
    this.#socket.on("error", handler);

    return () => {
      this.#socket.off("error", handler);
    };
  }

  send(message: string): boolean {
    if (!this.open) return false;

    this.#socket.send(message);

    return true;
  }

  ping(): void {
    if (this.open) this.#socket.ping();
  }
  close(code: number, reason: string): void {
    this.#socket.close(code, reason);
  }
  terminate(): void {
    this.#socket.terminate();
  }
}

/** Owns the upgrade and socket lifecycle; feature code receives only declared facts. */
export class WebSocketProtocol<App, Facts extends z.ZodObject> {
  readonly #options;
  #server: WebSocketServer | null = null;

  static create<App, Facts extends z.ZodObject>(options: {
    path: string;
    maxPayloadBytes: number;
    facts: Facts;
    headers: { [Key in keyof z.input<Facts>]: string };
    handle: (app: App, connection: ProtocolConnection, facts: z.output<Facts>) => Promise<void>;
  }): WebSocketProtocol<App, Facts> {
    return new WebSocketProtocol(options);
  }

  private constructor(options: {
    path: string;
    maxPayloadBytes: number;
    facts: Facts;
    headers: { [Key in keyof z.input<Facts>]: string };
    handle: (app: App, connection: ProtocolConnection, facts: z.output<Facts>) => Promise<void>;
  }) {
    this.#options = options;
  }

  mount(router: ConnectUpgradeRouter, app: App): void {
    if (this.#server) throw new Error("The WebSocket protocol is already mounted.");

    const server = new WebSocketServer({
      noServer: true,
      maxPayload: this.#options.maxPayloadBytes,
    });

    this.#server = server;

    router.register(this.#options.path, (request, socket, head) => {
      const values = Object.fromEntries(
        Object.entries(this.#options.headers).map(([key, name]) => {
          const value = request.headers[String(name).toLowerCase()];

          return [key, Array.isArray(value) ? value[0] : value];
        }),
      );

      const facts = this.#options.facts.safeParse(values);

      if (!facts.success) {
        socket.destroy();

        return;
      }

      server.handleUpgrade(request, socket, head, (socket) => {
        const connection = new WebSocketConnection(socket);

        socket.on("error", () => {
          connection.terminate();
        });

        void this.#options.handle(app, connection, facts.data).catch(() => {
          connection.close(1011, "Connection setup failed");
        });
      });
    });
  }

  async close(): Promise<void> {
    const server = this.#server;
    if (!server) return;

    this.#server = null;
    for (const connection of server.clients) connection.terminate();

    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
