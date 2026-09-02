import { AgentService } from "@langwatch/agent-contract";
import { AgentApp, AgentTrpcApi, type AgentTrpcContext } from "@langwatch/agent-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { runWithContext } from "@langwatch/observability/context";
import { SecretService } from "@langwatch/secret-contract";
import { SecretApp, SecretTrpcApi, type SecretTrpcContext } from "@langwatch/secret-server";
import { TRPCError, type TRPCDefaultErrorShape, type TRPCRouterRecord } from "@trpc/server";
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
import { Hono } from "hono";
import superjson from "superjson";
import type { TopicApiFeature } from "./features/topic/topic-api.feature";
import type { ApiRequestFailureCapturePort } from "./api-process.lifecycle";
import type { SseSubscriptionPorts } from "./app-trpc/app-trpc.sse";
import { createApiTrpcPolicy } from "./app-trpc/app-trpc.policy";
import type { ApiTrpcFeatureApplication, ApiTrpcSession } from "./app-trpc/app-trpc.context";

export type ApiActor = Readonly<{ id: string }>;
export type ApiServices = Readonly<{ agents: AgentApp; secrets: SecretApp }>;

/** The HTTP host authenticates a request then supplies these policy operations. */
export type ApiRequestContext = Readonly<{
  actor(): ApiActor;
  /**
   * The caller when there is one, and `null` when the request is anonymous.
   *
   * `actor()` refuses instead of answering `null`, which is right for a
   * resolver and wrong for the policy chain: the declared authorization check
   * has to answer "unauthenticated" BEFORE it looks at any scope id, and the
   * request logger stamps a user id on a call that may legitimately have none.
   * Both read this rather than catching the refusal.
   */
  tryActor?(): ApiActor | null;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
  can?(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
  authorizeScopeLineage?(input: unknown, permission: AuthzPermission): Promise<void>;
  /**
   * The signed-in person as the surfaces that RENDER them read it — their
   * name, picture and staff role — rather than the id authorization decides
   * on. Absent for an anonymous caller, and absent entirely on a process that
   * mounts no packaged surface.
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

type ApiErrorFormatter = (options: {
  shape: TRPCDefaultErrorShape;
  error: { cause?: unknown; message?: string; code?: string };
}) => TRPCDefaultErrorShape;

/**
 * The subscription lane, built against the caller this application resolves.
 *
 * A function rather than a Hono, because the lane cannot exist before the
 * caller does: the process's REST security declares the route's access policy,
 * and only the application holds the tRPC root a path is looked up on. Handing
 * over the ports is what lets those two be composed in either order.
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
 * The context every procedure on this process resolves against.
 *
 * Three groups, and they are not interchangeable. The first is the request
 * policy the host supplied. The second is what the packaged POLICY CHAIN reads
 * and writes — `permissionChecked` is the fail-closed backstop's flag and
 * `organizationRole` is what a resolved project check leaves behind — so both
 * are mutable where everything else is not. The third is the application, in
 * the one shape both this process's own routers and every packaged surface
 * read it.
 */
type ApiTrpcContext = Omit<ApiRequestContext, "can"> & {
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
  permissionChecked: boolean;
  organizationRole?: string | null;
  /**
   * Present and `null` rather than absent for an anonymous caller. The
   * surfaces that read a session all narrow on `null`, and a key that may be
   * missing entirely is a third state none of them describe.
   */
  session: ApiTrpcSession | null;
} & AgentTrpcContext &
  SecretTrpcContext & {
    app: ApiServices & ApiTrpcFeatureApplication;
  };

/** This process's one tRPC root, as the mount its features are built on names it. */
export type ApiTrpcRoot = ReturnType<typeof createTrpcRoot>;

/**
 * What a packaged feature record is built against: the root a feature router
 * must never create a second of, the two procedures it builds on, and the
 * concrete middlewares its policy chain is composed from.
 *
 * Structurally `TrpcApiMount & TrpcApiPublicMount` for this process's context,
 * written out rather than imported generically so the port below can name it
 * without carrying three type parameters through the whole application.
 */
export type ApiTrpcFeatureMount = Readonly<{
  root: ApiTrpcRoot;
  protectedProcedure: ApiTrpcRoot["procedure"];
  publicProcedure: ApiTrpcRoot["procedure"];
  middlewares: AppTrpcPolicyMiddlewares;
}>;

/**
 * The packaged tRPC surfaces this process serves beyond its own two, and
 * everything their policy chain needs.
 *
 * A port rather than a value because the record cannot be built before the
 * root exists, and the root belongs to the application: the composition hands
 * over a builder, the application calls it with its own mount, and the
 * namespaces land on the SAME root the subscription lane resolves paths on.
 *
 * Absent for a process that composed none — this application then serves
 * exactly what it served before, and every `ctx.app` slice a packaged surface
 * would have read is absent rather than faked.
 */
export abstract class ApiTrpcFeaturesPort {
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
  abstract build(mount: ApiTrpcFeatureMount): TRPCRouterRecord;
}

class MissingAgentService extends AgentService {
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
}

/**
 * What stands in when a process composed no secret service.
 *
 * Its methods are unreachable through HTTP — the router and the REST family
 * are not mounted without a service — and it exists so the tRPC context keeps
 * one shape whether or not the service was composed. A caller that reaches it
 * some other way is told the process is not configured for secrets rather
 * than getting a null-pointer failure three layers down.
 */
class MissingSecretService extends SecretService {
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

function defaultErrorFormatter({
  shape,
  error,
}: Parameters<NonNullable<ApiHttpOptions["errorFormatter"]>>[0]) {
  const handled = HandledError.isHandled(error.cause) ? error.cause : undefined;
  return {
    ...shape,
    message: handled?.code ?? shape.message,
    data: { ...shape.data, error: handled?.serialize() ?? null },
  };
}

/**
 * What stands in for the packaged application on a process that composed no
 * packaged surfaces.
 *
 * Unreachable through HTTP — none of the routers that read these slices are
 * mounted without a features port — and it exists so the tRPC context keeps one
 * shape either way. Reaching a slice some other way says which application is
 * missing rather than failing on `undefined` three layers down, which is the
 * same bargain {@link MissingAgentService} and {@link MissingSecretService}
 * make one level up. A proxy rather than thirteen written-out doubles because
 * the answer is identical for every slice and a hand-written set would drift
 * from the list the moment a fourteenth surface is mounted.
 */
const unavailableFeatureApplication = new Proxy({} as ApiTrpcFeatureApplication, {
  get(_target, property) {
    throw new Error(
      `The ${String(property)} application is not configured for this API application: no packaged tRPC surfaces were composed.`,
    );
  },
});

function createTrpcRoot(errorFormatter: ApiErrorFormatter) {
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
export class ApiApplication {
  private static readonly unavailableAgents = AgentApp.create({
    agents: new MissingAgentService(),
  });

  private static readonly unavailableSecrets = SecretApp.create({
    secrets: new MissingSecretService(),
  });

  static create(options: {
    agents?: AgentService;
    /**
     * Absent for a process that composed no secret service: its tRPC router is
     * left off the root, the same way the agent router is.
     */
    secrets?: SecretService;
    topic?: TopicApiFeature;
    http?: ApiHttpOptions;
    rest?: Hono;
    /**
     * The packaged namespace record, when this process composed one. Absent
     * leaves the root exactly as it was: two routers, and no policy chain
     * built for surfaces that are not there.
     */
    features?: ApiTrpcFeaturesPort;
  }): ApiApplication {
    options.topic?.install();
    return new ApiApplication(
      {
        agents: options.agents ? AgentApp.create({ agents: options.agents }) : undefined,
        secrets: options.secrets ? SecretApp.create({ secrets: options.secrets }) : undefined,
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
    private readonly services: Readonly<{
      agents: AgentApp | undefined;
      secrets: SecretApp | undefined;
    }>,
    private readonly http: ApiHttpOptions | undefined,
    rest: Hono | undefined,
    readonly topic: TopicApiFeature | undefined,
    private readonly features: ApiTrpcFeaturesPort | undefined,
  ) {
    this.root = createTrpcRoot(http?.errorFormatter ?? defaultErrorFormatter);
    const protectedProcedure = this.createProtectedProcedure();
    const agents = services.agents
      ? AgentTrpcApi.create(this.root, { protected: protectedProcedure })
      : undefined;
    const secrets = services.secrets
      ? SecretTrpcApi.create(this.root, { protected: protectedProcedure })
      : undefined;
    this.trpc = this.root.router({
      ...(agents ? { agents } : {}),
      ...(secrets ? { secrets } : {}),
      // Spread rather than nested: every packaged surface is keyed by the wire
      // namespace it has always answered on, and nesting them under one key
      // would rename all twenty-two of them at once.
      ...this.buildFeatureRouters(),
    });
    this.hono = http ? this.createHono(http, rest) : undefined;
  }

  /**
   * The packaged namespaces, built on this process's own mount.
   *
   * The policy chain is composed HERE rather than in the composition root for
   * the same reason the record is: every middleware belongs to the root that
   * produced it, and only the application holds that root.
   */
  private buildFeatureRouters(): TRPCRouterRecord {
    const features = this.features;
    if (!features) return {};

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
          return context.tryActor?.() ?? undefined;
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

  private requireServices(): ApiServices {
    return {
      agents: this.services.agents ?? ApiApplication.unavailableAgents,
      secrets: this.services.secrets ?? ApiApplication.unavailableSecrets,
    };
  }

  private withServices(context: ApiRequestContext): ApiTrpcContext {
    return {
      ...context,
      can: context.can ?? (async () => false),
      // Written by the declared check and read by the fail-closed backstop, so
      // it starts false on EVERY request: a flag carried over from a previous
      // call would be a procedure that passes because another one was checked.
      permissionChecked: false,
      session: context.session ?? null,
      app: {
        ...this.requireServices(),
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
    const handler = async (request: Request): Promise<Response> =>
      fetchRequestHandler({
        endpoint,
        req: request,
        router: this.trpc,
        createContext: async () => this.withServices(await http.createContext(request)),
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
    hono.get(`${endpoint}/*`, (context) => handler(context.req.raw));
    hono.post(`${endpoint}/*`, (context) => handler(context.req.raw));
    // The subscription lane runs the SAME router these two endpoints serve, so
    // a procedure is reachable live exactly when it is reachable at all — one
    // root, two transports, rather than a second surface that could drift.
    const subscriptions = http.subscriptions?.({
      createCaller: async ({ request, signal }) =>
        this.trpc.createCaller(
          this.withServices(await http.createContext(request)),
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
