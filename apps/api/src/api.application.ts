import { AgentService } from "@langwatch/agent-contract";
import {
  AgentApp,
  AgentTrpcApi,
  type AgentAppDependencies,
  type AgentTestPort,
  type AgentTrpcContext,
} from "@langwatch/agent-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError, isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { runWithContext } from "@langwatch/observability/context";
import { SecretService } from "@langwatch/secret-contract";
import { SecretApp, SecretTrpcApi, type SecretTrpcContext } from "@langwatch/secret-server";
import {
  TRPCError,
  type AnyTRPCRouter,
  type TRPCCreateRouterOptions,
  type TRPCDefaultErrorShape,
} from "@trpc/server";
import {
  TrpcRootDefinition,
  type AppTrpcPolicyMiddlewares,
  type TrpcAuthorizationDecisions,
  type TrpcAuthorizationDenialPort,
  type TrpcCauseTranslationPort,
  type TrpcErrorReportingPort,
  type TrpcRequestLike,
} from "@langwatch/api/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { trace } from "@opentelemetry/api";
import { Hono, type Context } from "hono";
import superjson from "superjson";
import type { AppTrpcFeatureRecord } from "./app-trpc/app-trpc.features";
import type { TopicApiFeature } from "./features/topic/topic-api.feature";
import type { ApiRequestFailureCapturePort } from "./api-process.lifecycle";
import type { SseSubscriptionPorts } from "./app-trpc/app-trpc.sse";
import { apiClientAddress, apiSocketAddress } from "./app/api-client-address";
import { appTrpcErrorFormatter } from "./app-trpc/app-trpc.error-formatter";
import { createApiTrpcPolicy } from "./app-trpc/app-trpc.policy";
import type {
  ApiTrpcEnterpriseRequest,
  ApiTrpcFeatureApplication,
  ApiTrpcSession,
} from "./app-trpc/app-trpc.context";

export type ApiActor = Readonly<{ id: string }>;

/**
 * The bucket a caller whose address this process cannot place lands in. Its
 * own key rather than a constant shared with every resolved caller, so one
 * unplaceable client cannot spend the whole deployment's signed-out budget.
 */
const UNRESOLVED_CLIENT_ADDRESS = "unresolved";
export type ApiServices = Readonly<{ agents: AgentApp; secrets: SecretApp }>;

/** The HTTP host authenticates a request then supplies these policy operations. */
export type ApiRequestContext = Readonly<{
  actor(): ApiActor;
  /**
   * The caller when there is one, and `null` when the request is anonymous.
   */
  tryActor?(): ApiActor | null;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
  can?(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
  authorizeScopeLineage?(input: unknown, permission: AuthzPermission): Promise<void>;
  /**
   * The signed-in person as the surfaces that RENDER them read it — their name, picture
   * and staff role — rather than the id authorization decides on. Absent for an anonymous
   * caller, and absent entirely on a process that mounts no packaged surface.
   */
  session?: ApiTrpcSession | null;
  /** The transport, as the request log line and the audit row describe it. */
  req?: TrpcRequestLike;
}>;

export type ApiAuditEvent = Readonly<{
  actorId: string;
  path: string;
  input: unknown;
  error: unknown;
}>;

export type ApiErrorFormatter = (options: {
  shape: TRPCDefaultErrorShape;
  error: { cause?: unknown; message?: string; code?: string };
}) => TRPCDefaultErrorShape;

/**
 * The subscription lane, built against the caller this application resolves.
 */
export type ApiSubscriptionMount = (ports: SseSubscriptionPorts) => Hono;

export type ApiHttpOptions = Readonly<{
  createContext(request: Request): Promise<ApiRequestContext>;
  audit?(event: ApiAuditEvent): Promise<void>;
  endpoint?: string;
  logger?: Pick<Logger, "error" | "info">;
  errorCapture?: ApiRequestFailureCapturePort;
  errorFormatter?: ApiErrorFormatter;
  /**
   * Absent for a process that serves no subscriptions. Present, it is mounted
   * beside the tRPC endpoint on the same origin, which is the whole reason the
   * browser's `EventSource` carries its session cookie at all.
   */
  subscriptions?: ApiSubscriptionMount;
}>;

/**
 * The context every procedure on this process resolves against. Three groups, and they
 * are not interchangeable. The first is the request policy the host supplied.
 */
type ApiTrpcContext = Omit<ApiRequestContext, "can"> & {
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
  /**
   * The caller's address, as the trusted-proxy resolver answers it, and the key every
   * per-IP limit on the signed-out surfaces uses.
   */
  clientIp(): string;
  permissionChecked: boolean;
  organizationRole?: string | null;
  /**
   * Present and `null` rather than absent for an anonymous caller. The
   * surfaces that read a session all narrow on `null`, and a key that may be
   * missing entirely is a third state none of them describe.
   */
  session: ApiTrpcSession | null;
  /**
   * The browser's own abort signal on a SUBSCRIPTION, and `undefined` on every ordinary
   * request.
   */
  signal: AbortSignal | undefined;
  /**
   * The operator scope the platform-tier check resolves. Written by that check and read
   * by the surface behind it.
   */
  opsScope: { kind: "platform" | "none" } | undefined;
} & AgentTrpcContext &
  SecretTrpcContext &
  /**
   * `undefined` on every request here, deliberately: see {@link
   * ApiTrpcEnterpriseRequest}.
   */
  ApiTrpcEnterpriseRequest & {
    app: ApiServices & ApiTrpcFeatureApplication;
  };

/** This process's one tRPC root, as the mount its features are built on names it. */
export type ApiTrpcRoot = ReturnType<typeof createTrpcRoot>;

/**
 * What a packaged feature record is built against: the root a feature router must never
 * create a second of, the two procedures it builds on, and the concrete middlewares its
 * policy chain is composed from.
 */
export type ApiTrpcFeatureMount = Readonly<{
  root: ApiTrpcRoot;
  protectedProcedure: ApiTrpcRoot["procedure"];
  publicProcedure: ApiTrpcRoot["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/**
 * The packaged tRPC surfaces this process serves beyond its own two, and everything their
 * policy chain needs.
 */
export abstract class ApiTrpcFeaturesPort<
  TRecord extends TRPCCreateRouterOptions = AppTrpcFeatureRecord,
> {
  /** The AuthZ decisions every declared check and the lineage guard run on. */
  abstract readonly authorization: TrpcAuthorizationDecisions;
  /** The two refusals whose concrete error class is this process's to choose. */
  abstract readonly denials: TrpcAuthorizationDenialPort;
  /** Application error classes the chain answers with a code of its own. */
  abstract readonly causes: TrpcCauseTranslationPort;
  /** Where an unhandled server fault is reported. */
  abstract readonly errorReporting: TrpcErrorReportingPort;
  /** The application slices the mounted surfaces read off `ctx.app`. */
  abstract readonly application: ApiTrpcFeatureApplication;
  /** Builds the namespace record on this process's mount. */
  abstract build(mount: ApiTrpcFeatureMount): TRecord;
}

export class MissingAgentService extends AgentService {
  private unavailable(): never {
    throw new Error("Agent service is not configured for this API application.");
  }

  getById() {
    return this.unavailable();
  }

  getAll() {
    return this.unavailable();
  }

  getReferenceStates() {
    return this.unavailable();
  }

  getNamesByIds() {
    return this.unavailable();
  }

  exists() {
    return this.unavailable();
  }

  list() {
    return this.unavailable();
  }

  create() {
    return this.unavailable();
  }

  update() {
    return this.unavailable();
  }

  archive() {
    return this.unavailable();
  }

  relatedEntities() {
    return this.unavailable();
  }

  cascadeArchive() {
    return this.unavailable();
  }

  getCopies() {
    return this.unavailable();
  }

  getSourceOfCopy() {
    return this.unavailable();
  }

  copy() {
    return this.unavailable();
  }

  pushToCopies() {
    return this.unavailable();
  }

  syncFromSource() {
    return this.unavailable();
  }

  getHistory() {
    return this.unavailable();
  }

  registerConnected() {
    return this.unavailable();
  }

  ownersOf() {
    return this.unavailable();
  }

  getConnectedByNameAndEnvironment() {
    return this.unavailable();
  }
}

/**
 * What a process passes {@link ApiApplication.create} when it composed no secret service,
 * so `secrets.*` still mounts and answers by name instead of being absent from the wire.
 */
export class MissingSecretService extends SecretService {
  private unavailable(): never {
    throw new Error("Secret service is not configured for this API application.");
  }

  list() {
    return this.unavailable();
  }

  getValues() {
    return this.unavailable();
  }

  get() {
    return this.unavailable();
  }

  create() {
    return this.unavailable();
  }

  update() {
    return this.unavailable();
  }

  delete() {
    return this.unavailable();
  }
}

function handledErrorCode(error: HandledError): TRPCError["code"] {
  const codes: Partial<Record<number, TRPCError["code"]>> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    412: "PRECONDITION_FAILED",
    413: "PAYLOAD_TOO_LARGE",
    422: "UNPROCESSABLE_CONTENT",
    429: "TOO_MANY_REQUESTS",
  };
  return codes[error.httpStatus] ?? "INTERNAL_SERVER_ERROR";
}

/**
 * The wire shape a failed call arrives in, when the host supplies none.
 */
export const defaultErrorFormatter: ApiErrorFormatter = appTrpcErrorFormatter;

/**
 * What stands in for the packaged application on a process that composed no packaged
 * surfaces.
 */
const unavailableFeatureApplication = new Proxy({} as ApiTrpcFeatureApplication, {
  get(_target, property) {
    throw new Error(
      `The ${String(property)} application is not configured for this API application: no packaged tRPC surfaces were composed.`,
    );
  },
});

/**
 * What a process that composed no packaged surfaces mounts instead.
 */
export class NoApiTrpcFeatures extends ApiTrpcFeaturesPort<Record<string, never>> {
  private unavailable(): never {
    throw new Error(
      "No packaged tRPC surfaces were composed for this API application, so its policy chain has nothing to decide.",
    );
  }

  readonly authorization: TrpcAuthorizationDecisions = {
    getDecision: () => this.unavailable(),
    getProjectAnyDecision: () => this.unavailable(),
    checkScopeLineage: () => this.unavailable(),
  };

  readonly denials: TrpcAuthorizationDenialPort = {
    membershipDisabled: () => this.unavailable(),
    liteMemberRestricted: () => this.unavailable(),
  };

  readonly causes: TrpcCauseTranslationPort = { translate: () => undefined };

  readonly errorReporting: TrpcErrorReportingPort = {
    capture: () => this.unavailable(),
    asError: () => this.unavailable(),
  };

  readonly application = unavailableFeatureApplication;

  build(): Record<string, never> {
    return {};
  }
}

/**
 * This process's one tRPC root.
 */
export function createTrpcRoot(errorFormatter: ApiErrorFormatter = defaultErrorFormatter) {
  return TrpcRootDefinition.forContext<ApiTrpcContext>().create({
    transformer: superjson,
    errorFormatter,
  });
}

/**
 * The API process owns one tRPC root and one feature-service graph. Its HTTP
 * policy is injected at boot so platform-specific session and audit adapters
 * do not leak into feature packages.
 */
export class ApiApplication<TRecord extends TRPCCreateRouterOptions = AppTrpcFeatureRecord> {
  static create<TRecord extends TRPCCreateRouterOptions>(options: {
    /**
     * Required — a process that composes no real agent service passes
     * {@link MissingAgentService}, which mounts the router and refuses every
     * call by name instead of leaving `agents.*` off the wire.
     */
    agents: AgentService;
    /**
     * Runs "Test agent" over the Scenario application.
     */
    agentTesting?: AgentTestPort;
    /**
     * Reads presence off the connected-agent runtime (ADR-128).
     */
    connectedAgents?: AgentAppDependencies["connected"];
    /**
     * Required — a process that composes no real secret service passes
     * {@link MissingSecretService}, which mounts the router and refuses every
     * call by name instead of leaving `secrets.*` off the wire.
     */
    secrets: SecretService;
    topic?: TopicApiFeature;
    http?: ApiHttpOptions;
    rest?: Hono;
    /**
     * Required — a process that composed no packaged surfaces passes
     * {@link NoApiTrpcFeatures}, whose record is empty, so the root is exactly
     * what it was: two routers and nothing else.
     */
    features: ApiTrpcFeaturesPort<TRecord>;
  }): ApiApplication<TRecord> {
    options.topic?.install();
    return new ApiApplication<TRecord>(
      {
        agents: AgentApp.create({
          agents: options.agents,
          testing: options.agentTesting,
          ...(options.connectedAgents ? { connected: options.connectedAgents } : {}),
        }),
        secrets: SecretApp.create({ secrets: options.secrets }),
      },
      options.http,
      options.rest,
      options.topic,
      options.features,
    );
  }

  readonly hono: Hono | undefined;
  readonly trpc;

  private readonly root: ReturnType<typeof createTrpcRoot>;

  private constructor(
    private readonly services: ApiServices,
    private readonly http: ApiHttpOptions | undefined,
    rest: Hono | undefined,
    readonly topic: TopicApiFeature | undefined,
    private readonly features: ApiTrpcFeaturesPort<TRecord>,
  ) {
    this.root = createTrpcRoot(http?.errorFormatter ?? defaultErrorFormatter);
    const protectedProcedure = this.createProtectedProcedure();
    const agents = AgentTrpcApi.create(this.root, { protected: protectedProcedure });
    const secrets = SecretTrpcApi.create(this.root, { protected: protectedProcedure });
    this.trpc = this.root.router({
      agents,
      secrets,
      // Spread rather than nested: every packaged surface is keyed by the wire
      // namespace it has always answered on, and nesting them under one key
      // would rename all twenty-two of them at once.
      ...this.buildFeatureRouters(),
    });
    this.hono = http ? this.createHono(http, rest) : undefined;
  }

  /**
   * The packaged namespaces, built on this process's own mount.
   */
  private buildFeatureRouters(): TRecord {
    const features = this.features;

    const policy = createApiTrpcPolicy<ApiTrpcContext, ApiTrpcContext>(this.root, {
      authz: features.authorization,
      denials: features.denials,
      causes: features.causes,
      errorReporting: features.errorReporting,
      identity: {
        // The chain's own authentication step. It refuses an anonymous caller
        // by delegating to `actor()`, which is the process's one definition of
        // that refusal, and narrows nothing further: this process's signed-in
        // context IS its request context.
        authenticate: (ctx) => {
          ctx.actor();
          return ctx as unknown as ApiTrpcContext;
        },
        actor: (ctx) => {
          const context = ctx as unknown as ApiTrpcContext;
          const actor = context.tryActor?.();
          if (!actor) return undefined;
          // The id is the IMPERSONATED person's, which is what authorization
          // decides on; the real administrator behind them is stamped beside
          // it so an audit row says who actually did this.
          const impersonatorId = context.session?.user.impersonator?.id;
          return impersonatorId ? { id: actor.id, impersonatorId } : actor;
        },
      },
      audit: {
        record: async (entry) => {
          await this.http?.audit?.({
            actorId: entry.userId,
            path: entry.action,
            input: entry.args,
            error: entry.error ?? null,
          });
        },
      },
    });

    return features.build({
      root: this.root,
      protectedProcedure: policy.protectedProcedure,
      // The signed-out doors — the front door and `publicEnv` beside it — are
      // built on the root's bare procedure. They are the two surfaces a person
      // reaches before they have a session at all.
      publicProcedure: this.root.procedure,
      middlewares: policy.middlewares,
    });
  }

  createCaller(context: ApiRequestContext) {
    return this.trpc.createCaller(this.withServices(context));
  }

  /**
   * The request's headers as a plain record, which is the shape every surface that reads
   * `ctx.req` expects. A `Headers` instance would satisfy the type and answer `undefined`
   * to every lookup, because those surfaces index it rather than calling `get`.
   */
  private static headersOf(request: Request): Record<string, string> {
    return Object.fromEntries(request.headers);
  }

  private withServices(
    context: ApiRequestContext,
    request?: Request,
    transport?: Context,
  ): ApiTrpcContext {
    const socketAddress = transport ? apiSocketAddress(transport) : undefined;
    const clientAddress = transport ? apiClientAddress(transport) : undefined;
    return {
      ...context,
      clientIp: () => clientAddress ?? UNRESOLVED_CLIENT_ADDRESS,
      can: context.can ?? (async () => false),
      // Written by the declared check and read by the fail-closed backstop, so
      // it starts false on EVERY request: a flag carried over from a previous
      // call would be a procedure that passes because another one was checked.
      permissionChecked: false,
      session: context.session ?? null,
      // Replaced by the real one on the subscription lane, which is the only
      // transport that has a browser to lose.
      signal: undefined,
      // Written by the operator check when one runs; absent says it did not.
      opsScope: undefined,
      /**
       * The incoming request's headers, where one arrived. Pinned to `undefined` until
       * now, on the reasoning that this process never sees the hosted edge's geo headers
       * and quotes no currency from them.
       */
      req: request
        ? {
            headers: ApiApplication.headersOf(request),
            ...(socketAddress ? { socket: { remoteAddress: socketAddress } } : {}),
          }
        : undefined,
      app: {
        ...this.services,
        ...(this.features?.application ?? unavailableFeatureApplication),
      },
    };
  }

  private createProtectedProcedure() {
    const logger = this.http?.logger ?? createLogger("langwatch:api");
    const audit = this.http?.audit;
    const tracer = trace.getTracer("langwatch:api");

    return this.root.procedure.use(async ({ ctx, input, next, path, type }) => {
      return tracer.startActiveSpan(`trpc ${path}`, async (span) => {
        let actor: ApiActor | undefined;
        let failure: unknown;
        try {
          actor = ctx.actor();
          return await runWithContext({ userId: actor.id }, async () => {
            const result = await next();
            if (!result.ok) {
              const cause = result.error.cause;
              failure = result.error;
              if (HandledError.isHandled(cause)) {
                throw new TRPCError({
                  code: handledErrorCode(cause),
                  message: cause.message,
                  cause,
                });
              }
              if (isZodLikeError(cause)) {
                const validation = ValidationError.fromZodError(cause);
                throw new TRPCError({
                  code: handledErrorCode(validation),
                  message: validation.code,
                  cause: validation,
                });
              }
              logger.error({ path, type, error: result.error }, "tRPC call failed");
            } else {
              logger.info({ path, type }, "tRPC call");
            }
            return result;
          });
        } catch (error) {
          failure = error;
          throw error;
        } finally {
          if (type === "mutation" && audit && actor) {
            await audit({ actorId: actor.id, path, input, error: failure });
          }
          span.end();
        }
      });
    });
  }

  private createHono(http: ApiHttpOptions, rest: Hono | undefined): Hono {
    const endpoint = http.endpoint ?? "/api/trpc";
    /**
     * The request lane routes by procedure PATH and answers JSON either way, so it needs
     * a router, not this application's record type.
     */
    const router: AnyTRPCRouter = this.trpc;
    const handler = async (request: Request, transport?: Context): Promise<Response> =>
      fetchRequestHandler({
        endpoint,
        req: request,
        router,
        createContext: async () =>
          this.withServices(await http.createContext(request), request, transport),
      });
    const hono = new Hono();
    hono.onError(async (error, context) => {
      try {
        await http.errorCapture?.capture({ error, request: context.req.raw });
      } catch (captureError) {
        const logger = http.logger ?? createLogger("langwatch:api");
        logger.error({ error: captureError }, "API HTTP error capture failed");
      }
      return context.text("internal server error", 500);
    });
    // The Hono context travels with the request because it is the only thing
    // holding the socket peer, and the peer is what decides whether a
    // forwarding header may be read at all.
    hono.get(`${endpoint}/*`, (context) => handler(context.req.raw, context));
    hono.post(`${endpoint}/*`, (context) => handler(context.req.raw, context));
    // The subscription lane runs the SAME router these two endpoints serve, so
    // a procedure is reachable live exactly when it is reachable at all — one
    // root, two transports, rather than a second surface that could drift.
    const subscriptions = http.subscriptions?.({
      // The router's own record, which is the only place a procedure's TYPE
      // survives: the caller below exposes all three kinds as identical
      // callable leaves, so the lane cannot tell them apart from it.
      procedureTypeAt: (path) => procedureTypeOf(router, path),
      createCaller: async ({ request, signal }) =>
        this.trpc.createCaller(
          // On the context AND in the caller's options: a subscription
          // procedure reads whichever its own transport gives it, and only the
          // context reaches one resolved through a v10-shaped caller.
          { ...this.withServices(await http.createContext(request), request), signal },
          signal ? { signal } : {},
        ),
    });
    if (subscriptions) {
      hono.route("/", subscriptions);
    }
    if (rest) {
      hono.route("/", rest);
    }
    return hono;
  }
}

/**
 * What kind of procedure a composed router serves at a dotted path.
 */
function procedureTypeOf(
  router: AnyTRPCRouter,
  path: string,
): "query" | "mutation" | "subscription" | undefined {
  const procedures: Record<string, { _def?: { type?: unknown } } | undefined> =
    router._def.procedures;
  const type = procedures[path]?._def?.type;
  return type === "query" || type === "mutation" || type === "subscription" ? type : undefined;
}
