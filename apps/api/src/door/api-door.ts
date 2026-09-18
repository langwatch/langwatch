// This process's ONE door: every declared REST family and tRPC namespace
// mounts here at boot, and the server hosts the result behind /healthz.
import { IdempotencyLedger, type MountableRestApp } from "@langwatch/api/rest";
import { AuthApi } from "@langwatch/auth-contract";
import type {
  FeatureRestMountOptions,
  FeatureTransportHosts,
  FeatureTrpcMountOptions,
  MountableTransport,
  TransportAuthSupply,
  TransportPeers,
} from "@langwatch/kernel";
import type { Logger } from "@langwatch/observability";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import type { IncomingMessage, ServerResponse } from "node:http";

import { composeApiTrpcSession } from "./api-browser-session.ts";
import { ApiRestHost } from "./api-rest.host.ts";
import { ApiTrpcHost, type ApiTrpcNamespace } from "./api-trpc.host.ts";

/** Where the door is tried on the server: after the built-in routes. */
const DOOR_ORDER = 100;

/** What the process states about its own door, beyond the peers boot resolves. */
export type ApiDoorComposition = Readonly<{
  peers: TransportPeers;
  /** The static bearers this deployment resolved, as the chain stated them. */
  auth: TransportAuthSupply;
  members: ProcessMemberSource;
  /** Whether this deployment has somewhere to keep receipts and count windows. */
  stores: Readonly<{ database: boolean; redis: boolean }>;
  logger: Logger;
}>;

/**
 * The product surface as the server hosts it — `{ name, order, handle }` by
 * shape, so `@langwatch/api` stays a transport framework and learns nothing
 * about the process that serves it.
 */
export class ApiDoor {
  /**
   * Opened once, at the one moment boot allows it: every module's application
   * exists and nothing serves yet, so a door reaching a peer gets the same
   * instance every other caller of that module holds.
   */
  static create(composition: ApiDoorComposition): ApiDoor {
    const { peers, auth, members, stores, logger } = composition;
    const sessions = peers.find(AuthApi);
    // Every replayable create keeps its receipts in ONE ledger, and every
    // counted route counts against ONE window. A deployment without the store
    // behind either composes none, and a route declaring the behaviour is
    // refused at mount rather than answering as though it were protected.
    const idempotency = stores.database
      ? IdempotencyLedger.create({
          receipts: members.read("prisma"),
          cipher: members.read("encryption"),
        }).run
      : undefined;
    const rateLimiter = stores.redis ? members.read("rateLimiter") : undefined;

    const rest = ApiRestHost.create({
      peers,
      config: {
        // Which secret guards which internal family. One door, several
        // secrets: a cron bearer must not reach the agent manager.
        internalSecrets: {
          cron: auth.staticTokens.cronBearerToken,
          "langy-internal": auth.staticTokens.langyInternalBearerToken,
        },
        instanceAdminKey: auth.staticTokens.instanceAdminBearerToken,
        ...(idempotency ? { idempotency } : {}),
        ...(rateLimiter ? { rateLimiter } : {}),
      },
    });
    const trpc = ApiTrpcHost.create({
      peers,
      config: {
        logger,
        ...(sessions ? { browserSession: composeApiTrpcSession({ auth: sessions }) } : {}),
        ...(rateLimiter ? { throttle: { limiter: rateLimiter, policies: {} } } : {}),
      },
    });

    return new ApiDoor(rest, trpc, logger);
  }

  readonly name = "api";
  readonly order = DOOR_ORDER;

  private readonly root = new Hono();
  private readonly namespaces: Record<string, ApiTrpcNamespace> = {};
  private readonly listener = getRequestListener(this.root.fetch, {
    overrideGlobalObjects: false,
  });
  private composed = false;

  private constructor(
    private readonly rest: ApiRestHost,
    private readonly trpc: ApiTrpcHost,
    private readonly logger: Pick<Logger, "error">,
  ) {}

  /**
   * The doors boot mounts on. Each mount answers with the door itself: this
   * process opened ONE, so the server hosts one handler however many families
   * and namespaces arrived on it.
   */
  get hosts(): FeatureTransportHosts<ApiDoor, ApiDoor> {
    return {
      rest: { mount: (declaration, app, options) => this.mountRest(declaration, app, options) },
      trpc: { mount: (declaration, app, options) => this.mountTrpc(declaration, app, options) },
    };
  }

  /**
   * One request. The door answers only what it has a route for, so every
   * address it never claimed falls through to the browser bundle behind it.
   */
  async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    this.compose();
    if (!this.claims(request)) return false;

    await this.listener(request, response);
    return true;
  }

  private mountRest(
    declaration: MountableTransport,
    app: () => unknown,
    options?: FeatureRestMountOptions,
  ): ApiDoor {
    const family: MountableRestApp = this.rest.mount(declaration, app, options);
    // Each family carries its own absolute paths, so the root is a route
    // table rather than a prefix scheme.
    this.root.route("/", family);

    return this;
  }

  private mountTrpc(
    declaration: MountableTransport,
    app: () => unknown,
    options?: FeatureTrpcMountOptions,
  ): ApiDoor {
    const namespace = namespaceOf(declaration);
    this.namespaces[namespace] = this.trpc.mount(declaration, app, options);

    return this;
  }

  /**
   * The tRPC door, once: every namespace is mounted by the time a request
   * arrives, and one root over all of them is what makes a batched call
   * spanning two namespaces reachable.
   */
  private compose(): void {
    if (this.composed) return;
    this.composed = true;
    try {
      this.root.route("/", this.trpc.door(this.namespaces));
    } catch (error) {
      this.logger.error({ error }, "the api tRPC door could not be composed");
      throw error;
    }
  }

  /**
   * Whether this request is the door's, asked of Hono's own router — plus all
   * of `/api`, so an unserved endpoint answers 404 rather than a page.
   */
  private claims(request: IncomingMessage): boolean {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/api" || pathname.startsWith("/api/")) return true;
    const [matched] = this.root.router.match(request.method ?? "GET", pathname);

    return matched.length > 0;
  }
}

/** The wire name a tRPC declaration carries, or the wiring bug that it carries none. */
function namespaceOf(declaration: MountableTransport): string {
  if (
    "namespace" in declaration &&
    typeof declaration.namespace === "string" &&
    declaration.namespace.length > 0
  ) {
    return declaration.namespace;
  }

  throw new Error("A tRPC declaration reached the api door with no namespace.");
}
