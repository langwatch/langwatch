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

import { SurfaceUnverifiedError } from "./errors.ts";
import type { ApiDoor, RestIdentity } from "./hosting/api-door.ts";
import type { MiddlewareBinding } from "./hosting/transport-hosts.ts";
import { ConnectUpgradeRouter, type UpgradeHandler } from "./ports.ts";
import { projectCredentialOfRequest } from "./rest/credential.ts";
import { assertKeyKind, keyCredentialOf, type RestKeyKinds } from "./rest/key-credential.ts";
import { isRestCredentialBinding } from "./rest/request.ts";

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

/** A module's own session key door, asked at upgrade as a REST route behind it asks it (E2). */
export type WebSocketSessionKeyDoor<Session extends z.ZodType> = Readonly<{
  credential: "session_key";
  /** The door's session as the protocol reads it; one it refuses is no credential. */
  session: Session;
}>;

/** Who the module's session key door admitted, and the session it resolved. */
export type WebSocketSessionCaller<Session extends z.ZodType> = Readonly<{
  actor: Actor | null;
  scope: AuthzDeclaredScopeId | null;
  session: z.output<Session>;
}>;

type ProtocolShape<Context extends z.ZodObject> = Readonly<{
  path: string;
  maxPayloadBytes: number;
  middlewareContext: Context;
  headers: { [Key in keyof z.input<Context>]: string };
}>;

type OpenProtocol<App, Context extends z.ZodObject> = ProtocolShape<Context> &
  Readonly<{
    door?: undefined;
    handle: (app: App, connection: ProtocolConnection, context: z.output<Context>) => Promise<void>;
  }>;

/** A door refusal opens the socket too, so the protocol answers it in its own frames. */
type DooredProtocol<App, Context extends z.ZodObject> = ProtocolShape<Context> &
  Readonly<{
    door: WebSocketDoor;
    handle: (
      app: App,
      connection: ProtocolConnection,
      admitted: Readonly<{ middlewareContext: z.output<Context>; caller: WebSocketCaller }>,
    ) => Promise<void>;
    refuse: (app: App, connection: ProtocolConnection, failure: Error) => Promise<void>;
  }>;

type SessionKeyProtocol<
  App,
  Context extends z.ZodObject,
  Session extends z.ZodType,
> = ProtocolShape<Context> &
  Readonly<{
    door: WebSocketSessionKeyDoor<Session>;
    handle: (
      app: App,
      connection: ProtocolConnection,
      admitted: Readonly<{
        middlewareContext: z.output<Context>;
        caller: WebSocketSessionCaller<Session>;
      }>,
    ) => Promise<void>;
    refuse: (app: App, connection: ProtocolConnection, failure: Error) => Promise<void>;
  }>;

type ProtocolOptions<App, Context extends z.ZodObject, Session extends z.ZodType> =
  | OpenProtocol<App, Context>
  | DooredProtocol<App, Context>
  | SessionKeyProtocol<App, Context, Session>;

type Admission<Caller> = Readonly<{ caller: Caller }> | Readonly<{ failure: Error }>;

/** The doors a protocol may name, each resolved when an upgrade asks it. */
type ProtocolDoors = Readonly<{
  project: () => RestIdentity | null;
  session_key: () => RestIdentity | null;
}>;

function isSessionKeyProtocol<App, Context extends z.ZodObject, Session extends z.ZodType>(
  options: ProtocolOptions<App, Context, Session>,
): options is SessionKeyProtocol<App, Context, Session> {
  return options.door?.credential === "session_key";
}

/** Owns the upgrade and socket lifecycle; feature code receives only declared context. */
export class WebSocketProtocol<
  App,
  Context extends z.ZodObject,
  Session extends z.ZodType = z.ZodType,
> {
  readonly protocol = "websocket" as const;
  readonly #options: ProtocolOptions<App, Context, Session>;
  /** One server per mount: a dev reload mounts the next generation before the old one drains. */
  readonly #servers = new Set<WebSocketServer>();

  static create<App, Context extends z.ZodObject, Session extends z.ZodType = z.ZodType>(
    options: ProtocolOptions<App, Context, Session>,
  ): WebSocketProtocol<App, Context, Session> {
    return new WebSocketProtocol(options);
  }

  private constructor(options: ProtocolOptions<App, Context, Session>) {
    this.#options = options;
  }

  /** The declaration as the installer reads a transport back. */
  router(): this {
    return this;
  }

  mount(
    router: ConnectUpgradeRouter,
    app: App,
    doors: ProtocolDoors = { project: () => null, session_key: () => null },
  ): () => Promise<void> {
    const server = new WebSocketServer({
      noServer: true,
      maxPayload: this.#options.maxPayloadBytes,
    });

    this.#servers.add(server);

    router.register(this.#options.path, (request, socket, head) => {
      const values = Object.fromEntries(
        Object.entries(this.#options.headers).map(([key, name]) => {
          const value = request.headers[String(name).toLowerCase()];

          return [key, Array.isArray(value) ? value[0] : value];
        }),
      );

      const parsed = this.#options.middlewareContext.safeParse(values);

      if (!parsed.success) {
        socket.destroy();

        return;
      }

      const options = this.#options;
      if (!options.door) {
        server.handleUpgrade(request, socket, head, (opened) => {
          const connection = openConnection(opened);
          void options.handle(app, connection, parsed.data).catch(() => {
            connection.close(1011, "Connection setup failed");
          });
        });

        return;
      }

      const identity = doors[options.door.credential]();
      if (!identity) {
        logger.error({ path: options.path }, "no API door is open for a doored upgrade");
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
        socket.destroy();

        return;
      }

      const upgrade = { server, request, socket, head };
      const refuse = (connection: ProtocolConnection, failure: Error) =>
        options.refuse(app, connection, failure);
      if (isSessionKeyProtocol(options)) {
        openAfter({
          ...upgrade,
          admitted: admitSessionKey({ door: options.door, identity, request }),
          handle: (connection, caller) =>
            options.handle(app, connection, { middlewareContext: parsed.data, caller }),
          refuse,
        });

        return;
      }

      openAfter({
        ...upgrade,
        admitted: admit({ door: options.door, identity, request }),
        handle: (connection, caller) =>
          options.handle(app, connection, { middlewareContext: parsed.data, caller }),
        refuse,
      });
    });

    return () => this.#closeServer(server);
  }

  /** Closes every mount; a host closes only its own through the closer `mount` answered. */
  async close(): Promise<void> {
    await Promise.all([...this.#servers].map((server) => this.#closeServer(server)));
  }

  async #closeServer(server: WebSocketServer): Promise<void> {
    if (!this.#servers.delete(server)) return;
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

/** Opens the socket once the door answered, for the caller it admitted or the refusal it raised. */
function openAfter<Caller>({
  server,
  request,
  socket,
  head,
  admitted,
  handle,
  refuse,
}: {
  server: WebSocketServer;
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  admitted: Promise<Admission<Caller>>;
  handle: (connection: ProtocolConnection, caller: Caller) => Promise<void>;
  refuse: (connection: ProtocolConnection, failure: Error) => Promise<void>;
}): void {
  void admitted.then((admission) => {
    server.handleUpgrade(request, socket, head, (opened) => {
      const connection = openConnection(opened);
      const answered =
        "caller" in admission
          ? handle(connection, admission.caller)
          : refuse(connection, admission.failure);
      void answered.catch(() => {
        connection.close(1011, "Connection setup failed");
      });
    });
  });
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
}): Promise<Admission<WebSocketCaller>> {
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

/** A module's session key door asked at upgrade: no permission; its session parsed as on REST. */
async function admitSessionKey<Session extends z.ZodType>({
  door,
  identity,
  request,
}: {
  door: WebSocketSessionKeyDoor<Session>;
  identity: RestIdentity;
  request: IncomingMessage;
}): Promise<Admission<WebSocketSessionCaller<Session>>> {
  try {
    if (!identity.identify) throw new SurfaceUnverifiedError(door.credential);
    const caller = await identity.identify({ request: requestOf(request) });
    const session = door.session.safeParse(caller.session);
    if (!session.success) throw new SurfaceUnverifiedError(door.credential);

    return { caller: { actor: caller.actor, scope: caller.scope, session: session.data } };
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

  /** The module's own bindings; its session key door is the one a socket may name. */
  mount(
    declaration: object,
    app: () => unknown,
    options: Readonly<{ middlewareBindings?: readonly MiddlewareBinding[] }> = {},
  ): void {
    if (!(declaration instanceof WebSocketProtocol))
      throw new TypeError("A websocket transport must be declared with WebSocketProtocol.create.");

    const sessionKey = (options.middlewareBindings ?? []).find(
      (binding) => isRestCredentialBinding(binding) && binding.credential === "session_key",
    );
    const close = declaration.mount(this, app(), {
      project: () => this.#door,
      session_key: () =>
        sessionKey && isRestCredentialBinding(sessionKey) ? sessionKey.resolveIdentity() : null,
    });
    this.#closers.push(close);
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
