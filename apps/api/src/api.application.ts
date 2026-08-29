import { AgentService } from "@langwatch/agent-contract";
import { AgentTrpcApi, type AgentTrpcContext } from "@langwatch/agent-server";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { runWithContext } from "@langwatch/observability/context";
import type { SecretService } from "@langwatch/secret-contract";
import { SecretApp, SecretTrpcApi, type SecretTrpcContext } from "@langwatch/secret-server";
import { TRPCError, type TRPCDefaultErrorShape } from "@trpc/server";
import { TrpcRootDefinition } from "@langwatch/api/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import superjson from "superjson";
import type { TopicApiFeature } from "./features/topic/topic-api.feature";
import type { ApiRequestFailureCapturePort } from "./api-process.lifecycle";

export type ApiActor = Readonly<{ id: string }>;
export type ApiServices = Readonly<{ agents: AgentService; secrets: SecretApp }>;

/** The HTTP host authenticates a request then supplies these policy operations. */
export type ApiRequestContext = Readonly<{
  actor(): ApiActor;
  authorize(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<void>;
  can?(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
  authorizeScopeLineage?(input: unknown, permission: AuthzPermission): Promise<void>;
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

export type ApiHttpOptions = Readonly<{
  createContext(request: Request): Promise<ApiRequestContext>;
  audit?(event: ApiAuditEvent): Promise<void>;
  endpoint?: string;
  logger?: Pick<Logger, "error" | "info">;
  errorCapture?: ApiRequestFailureCapturePort;
  errorFormatter?: ApiErrorFormatter;
}>;

type ApiTrpcContext = Omit<ApiRequestContext, "can"> & {
  can(permission: AuthzPermission, target: Readonly<{ projectId: string }>): Promise<boolean>;
} & AgentTrpcContext &
  SecretTrpcContext & {
    app: ApiServices;
  };

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
  private static readonly unavailableAgents = new MissingAgentService();

  static create(options: {
    agents?: AgentService;
    secrets: SecretService;
    topic?: TopicApiFeature;
    http?: ApiHttpOptions;
    rest?: Hono;
  }): ApiApplication {
    options.topic?.install();
    return new ApiApplication(
      { agents: options.agents, secrets: SecretApp.create({ secrets: options.secrets }) },
      options.http,
      options.rest,
      options.topic,
    );
  }

  readonly hono: Hono | undefined;
  readonly trpc;

  private readonly root: ReturnType<typeof createTrpcRoot>;

  private constructor(
    private readonly services: Readonly<{
      agents: AgentService | undefined;
      secrets: SecretApp;
    }>,
    private readonly http: ApiHttpOptions | undefined,
    rest: Hono | undefined,
    readonly topic: TopicApiFeature | undefined,
  ) {
    this.root = createTrpcRoot(http?.errorFormatter ?? defaultErrorFormatter);
    const protectedProcedure = this.createProtectedProcedure();
    const agents = services.agents
      ? AgentTrpcApi.create(this.root, { protected: protectedProcedure })
      : undefined;
    const secrets = SecretTrpcApi.create(this.root, { protected: protectedProcedure });
    this.trpc = this.root.router({ ...(agents ? { agents } : {}), secrets });
    this.hono = http ? this.createHono(http, rest) : undefined;
  }

  createCaller(context: ApiRequestContext) {
    return this.trpc.createCaller(this.withServices(context));
  }

  private requireServices(): ApiServices {
    return {
      agents: this.services.agents ?? ApiApplication.unavailableAgents,
      secrets: this.services.secrets,
    };
  }

  private withServices(context: ApiRequestContext): ApiTrpcContext {
    return {
      ...context,
      can: context.can ?? (async () => false),
      app: this.requireServices(),
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
    if (rest) {
      hono.route("/", rest);
    }
    return hono;
  }
}
