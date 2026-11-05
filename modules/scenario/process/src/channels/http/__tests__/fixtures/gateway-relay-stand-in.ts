// A stand-in for the gateway's Twilio media relay (services/aigateway/adapters/mediarelay) that
// speaks its wire protocol: a ready frame on open, a joined notice with Twilio's signature, then
// frames passed verbatim. Go tests prove the real relay; this proves the worker's client of it.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import WebSocket, { WebSocketServer } from "ws";

const RELAY_PATH = "/v1/voice/relay";
const TWILIO_PATH = /^\/v1\/voice\/twilio\/([A-Za-z0-9_-]+)$/;

type StandInOptions = {
  /** Refuse every relay open with this status and gateway error code. */
  refuse?: { status: number; code: string };
  /** Answer a relay open with this text frame in place of the ready frame. */
  firstFrame?: string;
};

export class GatewayRelayStandIn {
  /** The request headers of every relay open, in order. */
  readonly opens: IncomingHttpHeaders[] = [];
  /** The worker socket of each relay, by relay id. */
  readonly workers = new Map<string, WebSocket>();
  private readonly sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  static async start(options: StandInOptions = {}): Promise<GatewayRelayStandIn> {
    const standIn = new GatewayRelayStandIn(options);
    await new Promise<void>((resolve) => standIn.server.listen(0, "127.0.0.1", resolve));
    return standIn;
  }

  private readonly server: Server;

  private constructor(private readonly options: StandInOptions) {
    this.server = createServer((_request, response) => response.writeHead(404).end());
    this.server.on("upgrade", (request, socket, head) => {
      const path = request.url ?? "";
      if (path === RELAY_PATH) {
        this.opens.push(request.headers);
        if (options.refuse) {
          const body = JSON.stringify({ error: { type: options.refuse.code, code: options.refuse.code } });
          socket.end(
            `HTTP/1.1 ${options.refuse.status} Refused\r\nContent-Type: application/json\r\n` +
              `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
          );
          return;
        }
        this.sockets.handleUpgrade(request, socket, head, (worker) => this.opened(worker));
        return;
      }
      const worker = this.workers.get(TWILIO_PATH.exec(path)?.[1] ?? "");
      if (!worker) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const signature = request.headers["x-twilio-signature"];
      this.sockets.handleUpgrade(request, socket, head, (twilio) =>
        this.joined({ worker, twilio, signature: typeof signature === "string" ? signature : undefined }),
      );
    });
  }

  /** The origin a worker's Connect upstream names. */
  get baseUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  /** Every relay id this stand-in handed out. */
  get relayIds(): string[] {
    return [...this.workers.keys()];
  }

  async close(): Promise<void> {
    for (const client of this.sockets.clients) client.terminate();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private opened(worker: WebSocket): void {
    if (this.options.firstFrame !== undefined) {
      worker.send(this.options.firstFrame);
      return;
    }
    const relayId = randomBytes(24).toString("base64url");
    this.workers.set(relayId, worker);
    worker.send(
      JSON.stringify({
        event: "langwatch.relay.ready",
        relay_id: relayId,
        stream_path: `/v1/voice/twilio/${relayId}`,
        expires_in_seconds: 150,
      }),
    );
  }

  private joined({
    worker,
    twilio,
    signature,
  }: {
    worker: WebSocket;
    twilio: WebSocket;
    signature: string | undefined;
  }): void {
    worker.send(
      JSON.stringify({
        event: "langwatch.relay.joined",
        ...(signature === undefined ? {} : { twilio_signature: signature }),
      }),
    );
    twilio.on("message", (data, isBinary) => worker.send(data, { binary: isBinary }));
    worker.on("message", (data, isBinary) => twilio.send(data, { binary: isBinary }));
    twilio.on("close", (code) => closeWith(worker, code));
    worker.on("close", (code) => closeWith(twilio, code));
  }
}

/** Ends `socket` with the other side's close code, as the relay passes one on. */
function closeWith(socket: WebSocket, code: number): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.close(code === 1005 || code === 1006 ? 1000 : code);
}
