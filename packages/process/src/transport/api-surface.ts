import { timingSafeEqual } from "node:crypto";

import {
  BatchingNotSupportedError,
  type RateLimiter,
  type RawHttpHost,
  SurfaceBlankSecretError,
  SurfaceUnconfiguredError,
  SurfaceUnverifiedError,
  type TransportPeers,
  type WebSocketHost,
} from "@langwatch/api";
import {
  type ApiDoor,
  BrowserBundle,
  FramedDocument,
  type HttpFailureAnswer,
  HttpMux,
  mountApiDiscovery,
  type NodeHandler,
  openApiDoor,
  type RestCaller,
  type RestIdentity,
  SessionReader,
  type TransportSelection,
} from "@langwatch/api/hosting";
import { ClientAddress, SecurityHeaders, type StorageEndpoints } from "@langwatch/api/policy";
import {
  bindRestMiddleware,
  BrowserSessionIdentity,
  canonicalErrorAnswer,
  defineRestMiddleware,
  IdempotencyLedger,
  type IdempotentRunner,
  projectCredentialOfRequest,
  projectRestFacts,
  RestHost,
  type RestTransportMiddlewareBinding,
} from "@langwatch/api/rest";
import {
  bindTrpcFact,
  defineTrpcFact,
  SseLane,
  TrpcHost,
  type TrpcRequestContext,
} from "@langwatch/api/trpc";
import type { RestResolvedProjectCredential } from "@langwatch/authorization";
import type { Logger } from "@langwatch/observability";
import { AdminSurfaceHiddenError, OpsApi } from "@langwatch/ops-contract";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { z } from "zod";

import type { ExposedSurface } from "../process-supply.ts";
import type { ApiUiBundle } from "./bundle-config.ts";

export type ApiSurfaceComposition = Readonly<{
  members: ProcessMemberSource;
  logger: Logger;
  stores: Readonly<{ database: boolean; redis: boolean }>;
  bundle: ApiUiBundle | undefined;
  storage: StorageEndpoints;
  internalBearers: ReadonlyMap<string, RestIdentity>;
  instanceAdmin: RestIdentity;
  trustedProxies: readonly string[] | undefined;
  executionProxyBaseUrl: string | undefined;
  /** The deployment's public address, which a proxy in front of the API may hide from it. */
  publicBaseUrl: string | undefined;
  production: boolean;
  selection: TransportSelection;
  /** The process's one upgrade router, where every declared socket protocol mounts. */
  sockets: WebSocketHost;
  /** The raw HTTP doors, answered ahead of every route as main answered MCP. */
  doors: RawHttpHost;
}>;

export function apiSurface(
  composition: ApiSurfaceComposition,
): (peers: TransportPeers) => ExposedSurface<unknown, unknown> {
  return (peers) => {
    const surface = ApiSurface.create(composition, peers);

    return { hosts: surface.hosts, serve: () => surface.serve() };
  };
}

class ApiSurface {
  static create(composition: ApiSurfaceComposition, peers: TransportPeers): ApiSurface {
    const { members, stores } = composition;
    // auth binds the one door; a process without it refuses here, by name (record §8).
    const door = openApiDoor(peers);
    const sessions = SessionReader.create({ verify: door.sessions });
    const idempotency = stores.database
      ? IdempotencyLedger.create({
          receipts: members.read("prisma"),
          cipher: members.read("encryption"),
        }).run
      : void 0;
    const rateLimiter = stores.redis ? members.read("rateLimiter") : void 0;

    return new ApiSurface({ composition, peers, door, sessions, idempotency, rateLimiter });
  }

  readonly #rest: RestHost | undefined;
  readonly #trpc: TrpcHost | undefined;

  private readonly composition: ApiSurfaceComposition;
  private readonly door: ApiDoor;
  private readonly sessions: SessionReader;

  private constructor({
    composition,
    peers,
    door,
    sessions,
    idempotency,
    rateLimiter,
  }: {
    composition: ApiSurfaceComposition;
    peers: TransportPeers;
    door: ApiDoor;
    sessions: SessionReader;
    idempotency: IdempotentRunner | undefined;
    rateLimiter: RateLimiter | undefined;
  }) {
    this.composition = composition;
    this.door = door;
    this.sessions = sessions;
    if (composition.selection.selected.rest)
      this.#rest = this.#restHost(peers, idempotency, rateLimiter);
    if (composition.selection.selected.trpc) this.#trpc = this.#trpcHost(rateLimiter);
  }

  #restHost(
    peers: TransportPeers,
    idempotency: IdempotentRunner | undefined,
    rateLimiter: RateLimiter | undefined,
  ): RestHost {
    return RestHost.create({
      identities: {
        ...this.door.identities,
        browser: this.#browserDoor(),
        scim_token: unboundDirectoryDoor(),
        instance_admin: this.composition.instanceAdmin,
      },
      bearers: (namespace) =>
        this.composition.internalBearers.get(namespace) ??
        bearerDoor({ name: namespace, token: void 0 }),
      audit: this.door.audit.rest,
      idempotency,
      rateLimiter,
      facts: this.#restFacts(peers.find(OpsApi)),
      entitlements: this.door.entitlements,
    });
  }

  #trpcHost(rateLimiter: RateLimiter | undefined): TrpcHost {
    return TrpcHost.create({
      sessions: this.sessions,
      authz: this.door.authz,
      logger: this.composition.logger,
      errorCausePayload: { payloadFor: browserCausePayload },
      audit: this.door.audit.trpc,
      throttle: rateLimiter ? { limiter: rateLimiter, policies: {} } : void 0,
      facts: this.#trpcFacts(),
      sessionVersions: this.door.authz,
      entitlements: this.door.entitlements,
    });
  }

  get hosts(): {
    rest: RestHost | undefined;
    trpc: TrpcHost | undefined;
    websocket: WebSocketHost;
    rawhttp: RawHttpHost;
  } {
    const { sockets, doors } = this.composition;
    return { rest: this.#rest, trpc: this.#trpc, websocket: sockets, rawhttp: doors };
  }

  serve(): NodeHandler {
    const { composition } = this;
    const { bundle } = composition;
    const selected = composition.selection.selected;
    const page = BrowserBundle.create({
      dist: selected.bundle ? bundle?.directory : void 0,
      publicConfig: () => bundle?.head ?? "",
      sessionReader: this.sessions,
      security: selected.bundle ? selected.bundle.security : SecurityHeaders.strict(),
      ...(selected.bundle && selected.bundle.authorizeDocument
        ? { authorizeDocument: selected.bundle.authorizeDocument }
        : {}),
    });
    const api = composeApiApplication({ rest: this.#rest, trpc: this.#trpc }, selected);
    const mux = HttpMux.create({ reporter: composition.logger })
      .use(ClientAddress.fromTrustedProxies({ addresses: composition.trustedProxies }))
      .use(SecurityHeaders.strict({ production: composition.production }))
      .route("/api", api, { onFailure: answerApiFailure });
    for (const path of apiRootPaths(api))
      mux.route(path, api, { onFailure: answerApiFailure, exact: true });
    for (const document of selected.documents)
      mux.route(document.path, FramedDocument.create(document));
    return composition.doors.ahead(mux.route("/", page).handler);
  }

  #browserDoor(): RestIdentity {
    return BrowserSessionIdentity.create({
      sessions: this.sessions,
      authz: this.door.authz,
      publicBaseUrl: this.composition.publicBaseUrl,
    });
  }

  async #adminActor(request: Request) {
    const caller = await this.sessions.read(request);
    if (!caller?.userId) return null;
    return { id: caller.userId, email: caller.email, impersonator: caller.impersonator };
  }

  #restFacts(ops: OpsApi | undefined): readonly RestTransportMiddlewareBinding[] {
    return [
      bindRestMiddleware(
        unsubscribeCallerAddress,
        (context) => ClientAddress.resolvedFor(context.req.raw) ?? null,
      ),

      // Main's hidden 404 for anyone not on the staff list, answered before the body is read.
      bindRestMiddleware(adminActor, async (context) => {
        const operator = await this.#adminActor(context.req.raw);
        const scope = await ops?.operatorScope(operator);
        if (scope?.kind !== "platform") throw new AdminSurfaceHiddenError();
        return operator;
      }),
      bindRestMiddleware(adminAuthSession, async (context) => {
        const caller = await this.sessions.read(context.req.raw);

        return caller?.authSessionId ? { id: caller.authSessionId } : null;
      }),
      bindRestMiddleware(adminAuditRequest, (context) => {
        const headers: Record<string, string> = {};
        context.req.raw.headers.forEach((value, name) => {
          headers[name] = value;
        });

        return { headers, remoteAddress: ClientAddress.resolvedFor(context.req.raw) ?? undefined };
      }),
      bindRestMiddleware(projectRestFacts, (context) => {
        const credential = projectCredentialOfRequest(context.req.raw);

        return {
          projectSlug: credential.project.slug,
          viewerUserId: credential.type === "legacyProjectKey" ? null : credential.userId,
          actorId: actorIdOf(credential),
        };
      }),
    ];
  }

  #trpcFacts() {
    return [
      bindTrpcFact(callerEmailFact, (ctx: TrpcRequestContext) => ctx.session?.user.email ?? null),
      bindTrpcFact(organizationSessionPersonFact, (ctx: TrpcRequestContext) =>
        ctx.session?.user
          ? {
              name: ctx.session.user.name ?? null,
              email: ctx.session.user.email ?? null,
              image: ctx.session.user.image ?? null,
            }
          : null,
      ),
      bindTrpcFact(opsOperatorFact, (ctx: TrpcRequestContext) =>
        ctx.session?.user
          ? {
              id: ctx.session.user.id,
              name: ctx.session.user.name ?? null,
              email: ctx.session.user.email ?? null,
              impersonator: ctx.session.user.impersonator
                ? {
                    id: ctx.session.user.impersonator.id,
                    email: ctx.session.user.impersonator.email ?? null,
                  }
                : null,
            }
          : null,
      ),
      bindTrpcFact(gatewaySessionFact, (ctx: TrpcRequestContext) => ctx.session ?? null),
      bindTrpcFact(
        currencyRequestHeadersFact,
        (ctx: TrpcRequestContext) => ctx.req?.headers ?? null,
      ),
      bindTrpcFact(shareViewerFact, (ctx: TrpcRequestContext) => {
        const userAgent = ctx.req?.headers["user-agent"];
        return {
          userId: ctx.tryActor()?.id ?? null,
          userAgent: typeof userAgent === "string" ? userAgent : null,
        };
      }),
    ];
  }
}

/** Constant-time, so how long a refusal takes says nothing about how much of it matched. */
function sameSecret({ presented, configured }: { presented: string; configured: string }): boolean {
  const presentedBytes = Buffer.from(presented);
  const configuredBytes = Buffer.from(configured);

  return (
    presentedBytes.length === configuredBytes.length &&
    timingSafeEqual(presentedBytes, configuredBytes)
  );
}

export function bearerDoor(options: { name: string; token: string | undefined }): RestIdentity {
  const { name, token } = options;
  const admit = (request: Request): RestCaller => {
    if (token === void 0) throw new SurfaceUnconfiguredError(name);
    const configured = token.trim();
    if (configured === "") throw new SurfaceBlankSecretError(name);
    const header = request.headers.get("authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
    if (!sameSecret({ presented, configured })) throw new SurfaceUnverifiedError(name);
    return { actor: null, scope: null, internal: { type: "internalSecret", secretName: name } };
  };

  return {
    authenticate: () => {
      throw new Error(`The "${name}" door asks no permission of the bearer it was opened on.`);
    },
    identify: ({ request }) => admit(request),
    identifyOptional: ({ request }) => admit(request),
  };
}

/** Main's instance-admin family: absent (404, before any credential) with no key set or on SaaS. */
export function instanceAdminDoor(options: {
  token: string | undefined;
  isSaas: boolean;
}): RestIdentity {
  return bearerDoor({ name: "instance-admin", token: options.isSaas ? void 0 : options.token });
}

/** The scim module binds this door on its own families (§4); unbound, it admits nobody. */
function unboundDirectoryDoor(): RestIdentity {
  return {
    authenticate: () => {
      throw new Error("The SCIM door asks no permission of the bearer it was opened on.");
    },
    identify: () => Promise.reject(new SurfaceUnverifiedError("scimToken")),
  };
}

function actorIdOf(resolved: RestResolvedProjectCredential): string {
  if (resolved.type === "legacyProjectKey") return resolved.project.id;
  if (resolved.type === "cliAccessToken") return resolved.userId;

  return resolved.userId ?? resolved.apiKeyId;
}

/** A cause with no body of its own (`toResponseBody`, read by TrpcHost) that names a limit. */
function browserCausePayload(cause: unknown): Record<string, unknown> | null {
  const limit = cause as { limitType?: string; current?: number; max?: number } | undefined;

  return limit?.limitType
    ? { limitType: limit.limitType, current: limit.current, max: limit.max }
    : null;
}

const unsubscribeCallerAddress = defineRestMiddleware(
  "unsubscribeCallerAddress",
  z.string().nullable(),
);

const operatorImpersonator = z.object({
  id: z.string().optional(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  image: z.string().nullish(),
});

const adminActor = defineRestMiddleware(
  "adminActor",
  z
    .object({
      id: z.string(),
      name: z.string().nullish(),
      email: z.string().nullish(),
      impersonator: operatorImpersonator.optional(),
    })
    .nullable(),
);

const adminAuthSession = defineRestMiddleware(
  "adminAuthSession",
  z.object({ id: z.string() }).nullable(),
);

const adminAuditRequest = defineRestMiddleware(
  "adminAuditRequest",
  z.object({ headers: z.record(z.string(), z.string()), remoteAddress: z.string().optional() }),
);

const callerEmailFact = defineTrpcFact("callerEmail", z.string().nullable());
const organizationSessionPersonFact = defineTrpcFact("organizationSessionPerson", z.unknown());
const opsOperatorFact = defineTrpcFact("opsOperator", z.unknown());
const currencyRequestHeadersFact = defineTrpcFact("currencyRequestHeaders", z.unknown());
const gatewaySessionFact = defineTrpcFact("gatewaySession", z.unknown());
const shareViewerFact = defineTrpcFact(
  "shareViewer",
  z.object({ userId: z.string().nullable(), userAgent: z.string().nullable() }),
);

/**
 * The API's whole surface: the tRPC lanes, every REST family, then the 404 — mount order is
 * match order, and only here is every declaration known to have mounted (ARCHITECTURE.md §4).
 */
export function composeApiApplication(
  hosts: {
    rest?: RestHost | undefined;
    trpc?: TrpcHost | undefined;
  },
  policies: { trpc?: SecurityHeaders; rest?: SecurityHeaders } = {},
): Hono {
  const root = new Hono();

  root.use("*", async (context, next) => {
    await next();

    const policy =
      context.req.path === TrpcHost.path || context.req.path.startsWith(`${TrpcHost.path}/`)
        ? policies.trpc
        : policies.rest;

    for (const [name, value] of Object.entries(policy?.headers ?? {})) context.header(name, value);
  });

  if (hosts.trpc) root.route("/", trpcLanes(hosts.trpc));

  if (hosts.rest) {
    mountApiDiscovery({ root, restApp: hosts.rest.app });
    root.route("/", hosts.rest.app);
  }

  // An address under this prefix that nothing serves is the API's own 404,
  // never a page the browser application would try to route.
  root.all("*", (context) => context.json({ error: "not_found" }, 404));

  return root;
}

/**
 * The literal paths the application serves outside `/api`, one per resource: a process routes
 * each here exactly, or the browser application answers them with its shell and a 200.
 */
function apiRootPaths(application: Hono): string[] {
  const paths = application.routes
    .map(({ path }) => (path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path))
    .filter((path) => path.startsWith("/") && path !== "/" && !/[*:]/.test(path))
    .filter((path) => path !== "/api" && !path.startsWith("/api/"));

  return [...new Set(paths)];
}

/**
 * How the API answers a failure that escaped its middleware or preceded it:
 * the SAME serializer the families answer through, so a client cannot tell
 * which layer failed — and never receives HTML for a pre-routing crash.
 */
const answerApiFailure: HttpFailureAnswer = (failure) => canonicalErrorAnswer(failure);

/**
 * Both tRPC lanes over ONE composed router: the request lane at `/api/trpc`,
 * and the subscription lane at `/api/sse`, so a procedure is reachable live
 * exactly when it is reachable at all.
 */
function trpcLanes(trpc: TrpcHost): Hono {
  const app = new Hono();
  app.onError((failure) => answerApiFailure(failure));

  app.all(`${TrpcHost.path}/*`, async (context) => {
    const request = context.req.raw;
    let resolved: Promise<TrpcRequestContext> | undefined;
    const createContext = () => {
      const address = ClientAddress.resolvedFor(request);
      resolved ??= trpc.context({ request, ...(address ? { address } : {}) });
      return resolved;
    };

    const { pathname, searchParams } = new URL(request.url);
    const path = pathname.slice(TrpcHost.path.length + 1);
    if (searchParams.has("batch") || /,|%2c/i.test(path)) {
      throw new BatchingNotSupportedError();
    }

    // The session version and, on a query, the schema hash ride every answer.
    const versionHeaders = {
      ...(await trpc.sessionVersionHeaders({ context: createContext })),
      ...trpc.schemaHashHeaders({ path }),
    };
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext,
      allowBatching: false,
    });
    for (const [name, value] of Object.entries(versionHeaders)) response.headers.set(name, value);

    return response;
  });

  const sse = SseLane.create({
    members: {
      procedureTypeAt: (path) => trpc.procedureTypeAt(path),
      createCaller: async ({ request, signal }) =>
        trpc.router.createCaller(
          // On the context AND in the caller's options: a subscription
          // procedure reads whichever its own transport gives it, and only
          // the context reaches one resolved through a v10-shaped caller.
          { ...(await trpc.context({ request, signal })), signal },
          signal ? { signal } : {},
        ),
    },
  });

  app.get("/api/sse/*", (context) => sse.answer(context.req.raw, context.res.headers));

  return app;
}
