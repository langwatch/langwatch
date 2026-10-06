import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import type {
  Actor,
  AuthzDeclaredScopeId,
  AuthzPermission,
  RestResolvedProjectCredential,
} from "@langwatch/authorization";
import { createLogger } from "@langwatch/observability";
import { WebSocket, WebSocketServer } from "ws";
import type { z } from "zod";

import type { ApiDoor, RestIdentity } from "./hosting/api-door.ts";
import { ConnectUpgradeRouter, type UpgradeHandler } from "./ports.ts";
import { projectCredentialOfRequest } from "./rest/credential.ts";
import { assertKeyKind, keyCredentialOf, type RestKeyKinds } from "./rest/key-credential.ts";

const logger = createLogger("langwatch:api:websocket-door");

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

/** The door an upgrade passes before its socket opens: the project door, asked one permission. */
export type WebSocketDoor = Readonly<{
  credential: "project";
  permission: AuthzPermission;
  /** The key kinds the protocol admits; the door refuses any other with `KeyKindRefusedError`. */
  keyKinds?: RestKeyKinds;
}>;

/** Who the door admitted, and the project credential it resolved for the upgrade. */
export type WebSocketCaller = Readonly<{
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  credential: RestResolvedProjectCredential;
}>;

type ProtocolShape<Facts extends z.ZodObject> = Readonly<{
  path: string;
  maxPayloadBytes: number;
  facts: Facts;
  headers: { [Key in keyof z.input<Facts>]: string };
}>;

type OpenProtocol<App, Facts extends z.ZodObject> = ProtocolShape<Facts> &
  Readonly<{
    door?: undefined;
    handle: (app: App, connection: ProtocolConnection, facts: z.output<Facts>) => Promise<void>;
  }>;

/** A door refusal opens the socket too, so the protocol answers it in its own frames. */
type DooredProtocol<App, Facts extends z.ZodObject> = ProtocolShape<Facts> &
  Readonly<{
    door: WebSocketDoor;
    handle: (
      app: App,
      connection: ProtocolConnection,
      admitted: Readonly<{ facts: z.output<Facts>; caller: WebSocketCaller }>,
    ) => Promise<void>;
    refuse: (app: App, connection: ProtocolConnection, failure: Error) => Promise<void>;
  }>;

type ProtocolOptions<App, Facts extends z.ZodObject> =
  | OpenProtocol<App, Facts>
  | DooredProtocol<App, Facts>;

type Admission = Readonly<{ caller: WebSocketCaller }> | Readonly<{ failure: Error }>;

/** Owns the upgrade and socket lifecycle; feature code receives only declared facts. */
export class WebSocketProtocol<App, Facts extends z.ZodObject> {
  readonly protocol = "websocket" as const;
  readonly #options: ProtocolOptions<App, Facts>;
  #server: WebSocketServer | null = null;

  static create<App, Facts extends z.ZodObject>(
    options: ProtocolOptions<App, Facts>,
  ): WebSocketProtocol<App, Facts> {
    return new WebSocketProtocol(options);
  }

  private constructor(options: ProtocolOptions<App, Facts>) {
    this.#options = options;
  }

  /** The declaration as the installer reads a transport back. */
  router(): this {
    return this;
  }

  mount(
    router: ConnectUpgradeRouter,
    app: App,
    door: () => RestIdentity | null = () => null,
  ): void {
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

      const options = this.#options;
      if (!options.door) {
        server.handleUpgrade(request, socket, head, (opened) => {
          const connection = openConnection(opened);
          void options.handle(app, connection, facts.data).catch(() => {
            connection.close(1011, "Connection setup failed");
          });
        });

        return;
      }

      const identity = door();
      if (!identity) {
        logger.error({ path: options.path }, "no API door is open for a doored upgrade");
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        socket.destroy();

        return;
      }

      void admit({ door: options.door, identity, request }).then((admission) => {
        server.handleUpgrade(request, socket, head, (opened) => {
          const connection = openConnection(opened);
          const answered =
            "caller" in admission
              ? options.handle(app, connection, { facts: facts.data, caller: admission.caller })
              : options.refuse(app, connection, admission.failure);
          void answered.catch(() => {
            connection.close(1011, "Connection setup failed");
          });
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

function openConnection(socket: WebSocket): WebSocketConnection {
  const connection = new WebSocketConnection(socket);
  socket.on("error", () => {
    connection.terminate();
  });

  return connection;
}

/** The project door asked at upgrade time, as a REST route behind it asks it per request. */
async function admit({
  door,
  identity,
  request,
}: {
  door: WebSocketDoor;
  identity: RestIdentity;
  request: IncomingMessage;
}): Promise<Admission> {
  const asked = requestOf(request);
  try {
    const caller = await identity.authenticate({
      request: asked,
      permission: door.permission,
      permissions: [door.permission],
      ...(door.keyKinds ? { keyKinds: door.keyKinds } : {}),
    });
    const credential = projectCredentialOfRequest(asked);
    // The door is told the admitted kinds; the protocol still refuses one it let through.
    if (door.keyKinds) assertKeyKind({ key: keyCredentialOf(credential), admitted: door.keyKinds });
    caller.markUsed?.();

    return { caller: { actor: caller.actor, scope: caller.scope, credential } };
  } catch (error) {
    return { failure: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** The upgrade's headers as the request a door reads; an upgrade carries no body. */
function requestOf(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one);
  }

  return new Request(new URL(request.url ?? "/", "http://localhost"), { headers });
}

/**
 * The process's one upgrade listener, routed by path: every installed module's
 * protocol mounts here, and an upgrade for any other path is answered 404.
 */
export class WebSocketHost extends ConnectUpgradeRouter {
  readonly #handlers = new Map<string, UpgradeHandler>();
  readonly #closers: (() => Promise<void>)[] = [];
  #door: RestIdentity | null = null;

  static create(): WebSocketHost {
    return new WebSocketHost();
  }

  private constructor() {
    super();
  }

  /** The door every doored protocol asks at upgrade; the api process opens it before mounting. */
  withDoor(door: Pick<ApiDoor, "identities">): this {
    this.#door = door.identities.project;

    return this;
  }

  register(pathname: string, handler: UpgradeHandler): void {
    if (this.#handlers.has(pathname))
      throw new Error(`An upgrade handler is already registered for ${pathname}`);

    this.#handlers.set(pathname, handler);
  }

  mount(declaration: object, app: () => unknown): void {
    if (!(declaration instanceof WebSocketProtocol))
      throw new TypeError("A websocket transport must be declared with WebSocketProtocol.create.");

    declaration.mount(this, app(), () => this.#door);
    this.#closers.push(() => declaration.close());
  }

  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const handler = this.#handlers.get(pathname);

    if (!handler) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();

      return;
    }

    handler(request, socket, head);
  }

  async close(): Promise<void> {
    await Promise.all(this.#closers.map((close) => close()));
  }
}
