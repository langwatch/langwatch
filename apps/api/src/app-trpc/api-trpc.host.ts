/**
 * The api process's tRPC door.
 *
 * One root, one policy chain, one declared runtime — built once, at boot, from
 * the pieces that survived the old assembly: the browser-session context, the
 * error formatter, and the subscription lane. Every installed module's declared
 * namespace is mounted on THIS runtime, which is what makes a procedure
 * reachable over the request lane and over the stream lane at the same time.
 *
 * What the process owns here is the same list REST's door table owns: who the
 * caller is, what may be asked of them, where a mutation is recorded, and the
 * envelope a refusal is written in. A module declares its namespace and knows
 * none of it.
 */
import { AuditLogApi, recordAuditLogCommandSchema } from "@langwatch/audit-log-contract";
import {
  auditScopeIds,
  bindTrpcFact,
  browserSessionFact,
  callerAddressFact,
  TrpcRootDefinition,
  type TrpcAuthorizationDecisions,
  type TrpcAuthorizationDenial,
  type TrpcCauseTranslation,
  type TrpcErrorReporting,
  type TrpcFactBinding,
  type TrpcIdentity,
  type TrpcMountOptions,
  type TrpcRequestLike,
  type TrpcRoot,
  type TrpcRuntime,
} from "@langwatch/api/trpc";
import { AuthzApi, LiteMemberRestrictedError } from "@langwatch/authz-contract";
import { callerEmailFact } from "@langwatch/auth-server";
import { gatewaySessionFact } from "@langwatch/gateway-server";
import { opsOperatorFact } from "@langwatch/ops-server";
import { organizationSessionPersonFact } from "@langwatch/organization-server";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type {
  FeatureTrpcHost,
  FeatureTrpcMountOptions,
  MountableTransport,
  TransportPeers,
} from "@langwatch/runtime-composition";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { AnyTRPCRouter } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { Hono } from "hono";
import type { Context } from "hono";
import { apiClientAddress, apiSocketAddress, trpcClientAddress } from "../app/api-client-address.ts";
import { appTrpcErrorFormatter } from "./app-trpc.error-formatter.ts";
import { createApiTrpcPolicy } from "./app-trpc.policy.ts";
import { createSseSubscriptionApp } from "./app-trpc.sse.ts";

/** The address this process has always answered tRPC on. */
export const API_TRPC_ENDPOINT = "/api/trpc";

/** The signed-in person, as the procedures that render one read it. */
export type ApiTrpcSessionUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  /** The real administrator when one is acting as this person. */
  impersonator?: ApiTrpcSessionUser;
}>;

export type ApiTrpcSession = Readonly<{
  user: ApiTrpcSessionUser;
  /** The browser session's own id, where the deployment tracks one. */
  sessionId?: string;
}>;

/** What a browser cookie resolved, where this deployment composed a verifier. */
export type ApiTrpcSessionResolver = (request: Request) => Promise<ApiTrpcSession | null>;

/** The one context every procedure on this process is resolved against. */
export type ApiTrpcRequestContext = {
  readonly req?: TrpcRequestLike | undefined;
  readonly res?: { statusCode?: number } | undefined;
  /**
   * Written by the declared authorization check and read by the fail-closed
   * backstop, so it starts false on EVERY request: a flag carried over from a
   * previous call would be a procedure that passes because another one was
   * checked.
   */
  permissionChecked: boolean;
  organizationRole?: string | null;
  readonly session: ApiTrpcSession | null;
  /** Replaced by the real one on the subscription lane; absent elsewhere. */
  readonly signal?: AbortSignal | undefined;
  /** Refuses an anonymous caller. The process's ONE definition of that refusal. */
  actor(): Readonly<{ id: string }>;
  /** The same answer, or nothing: the logger has to describe an anonymous caller. */
  tryActor(): Readonly<{ id: string }> | undefined;
  clientIp(): string | undefined;
};

/** Whatever this process's root made of one declared namespace. */
export type ApiTrpcNamespace = unknown;

/** What the process states about its tRPC door, beyond the peers boot resolves. */
export type ApiTrpcDoorConfig = Readonly<{
  /** Absent leaves the door MOUNTED and every authenticated procedure refused. */
  browserSession?: ApiTrpcSessionResolver | undefined;
  /** Named in every log line this door writes. */
  logger?: Pick<Logger, "warn" | "error"> | undefined;
}>;

/**
 * The caller still holds a membership in this organization, but an admin
 * disabled it to stay within the licensed seat count, so it grants nothing.
 */
class MembershipDisabledError extends HandledError {
  declare readonly code: "membership_disabled";

  constructor() {
    super("membership_disabled", "Your access to this organization has been disabled", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "MembershipDisabledError";
  }
}

/**
 * Builds this process's tRPC root once, and mounts declared namespaces on it.
 */
export class ApiTrpcHost implements FeatureTrpcHost<ApiTrpcNamespace> {
  static create(options: {
    peers: TransportPeers;
    config: ApiTrpcDoorConfig;
  }): ApiTrpcHost {
    const { peers, config } = options;

    // The SAME AuthZ service the REST doors authorize through, never a second
    // one: two services for one organization is two permission caches.
    return new ApiTrpcHost(peers.app(AuthzApi), peers.find(AuditLogApi), config);
  }

  private readonly logger: Pick<Logger, "warn" | "error">;
  private readonly root: TrpcRoot<ApiTrpcRequestContext>;
  private readonly runtime: TrpcRuntime<ApiTrpcRequestContext>;

  private constructor(
    authz: TrpcAuthorizationDecisions,
    private readonly auditLog: Pick<AuditLogApi, "record"> | undefined,
    private readonly config: ApiTrpcDoorConfig,
  ) {
    this.logger = config.logger ?? createLogger("langwatch:api:trpc");
    this.root = TrpcRootDefinition.forContext<ApiTrpcRequestContext>().create({
      errorFormatter: appTrpcErrorFormatter,
    });
    this.runtime = createApiTrpcPolicy<ApiTrpcRequestContext, ApiTrpcRequestContext>(this.root, {
      authz,
      identity: this.identity(),
      audit: { record: (entry) => this.record(entry) },
      errorReporting: this.errorReporting(),
      causes: this.causes,
      denials: this.denials,
    }).declaredRuntime;
  }

  /**
   * One declared namespace on this process's root.
   *
   * The declaration arrives type-erased — `mountDeclaredTransports` knows
   * nothing of tRPC on purpose — so the cast IS the seam rather than a shortcut
   * around one. What the module bound for its own facts travels beside the
   * process's own bindings, and the process's go first so a module cannot
   * shadow the caller's address with one of its own.
   */
  mount(
    declaration: MountableTransport,
    app: () => unknown,
    options?: FeatureTrpcMountOptions,
  ): ApiTrpcNamespace {
    const mount = this.runtime.mount as unknown as (
      declaration: MountableTransport,
      app: (ctx: ApiTrpcRequestContext) => unknown,
      options?: TrpcMountOptions<ApiTrpcRequestContext>,
    ) => ApiTrpcNamespace;

    return mount(declaration, () => app(), {
      facts: [
        ...this.processFacts(),
        ...((options?.facts ?? []) as readonly TrpcFactBinding<ApiTrpcRequestContext>[]),
      ],
    });
  }

  /**
   * Every namespace boot mounted, as one router — the record keyed by the wire
   * name each declaration carries, spread rather than nested, because nesting
   * them under one key would rename every namespace at once.
   */
  compose(namespaces: Readonly<Record<string, ApiTrpcNamespace>>): AnyTRPCRouter {
    return this.runtime.router(namespaces) as AnyTRPCRouter;
  }

  /**
   * The door itself: the request lane at `/api/trpc`, and the subscription lane
   * over the SAME router, so a procedure is reachable live exactly when it is
   * reachable at all.
   */
  door(namespaces: Readonly<Record<string, ApiTrpcNamespace>>): Hono {
    const router = this.compose(namespaces);
    const app = new Hono();
    const handler = async (request: Request, transport?: Context): Promise<Response> =>
      fetchRequestHandler({
        endpoint: API_TRPC_ENDPOINT,
        req: request,
        router,
        createContext: async () => this.context({ request, transport }),
      });

    // The Hono context travels with the request because it is the only thing
    // holding the socket peer, and the peer is what decides whether a
    // forwarding header may be read at all.
    app.get(`${API_TRPC_ENDPOINT}/*`, (context) => handler(context.req.raw, context));
    app.post(`${API_TRPC_ENDPOINT}/*`, (context) => handler(context.req.raw, context));
    app.route(
      "/",
      createSseSubscriptionApp({
        members: {
          procedureTypeAt: (path) => procedureTypeOf(router, path),
          createCaller: async ({ request, signal }) =>
            router.createCaller(
              // On the context AND in the caller's options: a subscription
              // procedure reads whichever its own transport gives it, and only
              // the context reaches one resolved through a v10-shaped caller.
              { ...(await this.context({ request, signal })), signal },
              signal ? { signal } : {},
            ),
        },
      }),
    );

    return app;
  }

  /**
   * What this process knows about a caller that no module can. The two facts
   * `@langwatch/api/trpc` publishes are bound for EVERY namespace, because they
   * describe the request rather than the feature answering it.
   */
  private processFacts(): readonly TrpcFactBinding<ApiTrpcRequestContext>[] {
    return [
      bindTrpcFact(browserSessionFact, (ctx: ApiTrpcRequestContext) => ctx.session?.sessionId ?? null),
      bindTrpcFact(callerAddressFact, (ctx: ApiTrpcRequestContext) => ctx.clientIp() ?? null),
      // The four module-declared identity facts, bound once here — binding is
      // by NAME, so auth's callerEmail object also answers the by-name twins
      // three other modules still declare (a dedupe is queued, not urgent).
      // Each binding is the deleted assembly's own resolution, ported.
      bindTrpcFact(callerEmailFact, (ctx: ApiTrpcRequestContext) => ctx.session?.user.email ?? null),
      bindTrpcFact(organizationSessionPersonFact, (ctx: ApiTrpcRequestContext) =>
        ctx.session?.user
          ? { name: ctx.session.user.name ?? null, email: ctx.session.user.email ?? null }
          : null,
      ),
      bindTrpcFact(opsOperatorFact, (ctx: ApiTrpcRequestContext) =>
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
      bindTrpcFact(gatewaySessionFact, (ctx: ApiTrpcRequestContext) => ctx.session ?? null),
    ];
  }

  /** One request, resolved into the context every procedure reads. */
  private async context(input: {
    request: Request;
    transport?: Context | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<ApiTrpcRequestContext> {
    const { request, transport, signal } = input;
    const session = (await this.config.browserSession?.(request)) ?? null;
    const authenticated = session ? { id: session.user.id } : null;
    const socketAddress = transport ? apiSocketAddress(transport) : undefined;
    const honoAddress = transport ? apiClientAddress(transport) : undefined;
    const req: TrpcRequestLike = {
      headers: Object.fromEntries(request.headers),
      ...(socketAddress ? { socket: { remoteAddress: socketAddress } } : {}),
    };

    return {
      req,
      permissionChecked: false,
      session,
      ...(signal ? { signal } : {}),
      actor: () => {
        if (!authenticated) throw new TRPCError({ code: "UNAUTHORIZED" });
        return authenticated;
      },
      tryActor: () => authenticated ?? undefined,
      clientIp: () => honoAddress ?? trpcClientAddress(req),
    };
  }

  /**
   * Who the call is attributed to. `id` stays the IMPERSONATED person, which is
   * what the authorization decision is about; the administrator behind them
   * travels beside it so an audit row says who actually did this.
   */
  private identity(): TrpcIdentity<ApiTrpcRequestContext, ApiTrpcRequestContext> {
    return {
      authenticate: (ctx) => {
        const context = ctx as unknown as ApiTrpcRequestContext;
        context.actor();
        return context;
      },
      actor: (ctx) => {
        const context = ctx as unknown as ApiTrpcRequestContext;
        const actor = context.tryActor?.();
        if (!actor) return undefined;
        const impersonatorId = context.session?.user.impersonator?.id;

        return impersonatorId ? { id: actor.id, impersonatorId } : actor;
      },
    };
  }

  /**
   * The two refusals the declared check answers with. Supplied rather than
   * imported because the port says so: they carry product copy and a code the
   * client renders its own words from.
   */
  private readonly denials: TrpcAuthorizationDenial = {
    membershipDisabled: () => new MembershipDisabledError(),
    liteMemberRestricted: (resource: string) => new LiteMemberRestrictedError(resource),
  };

  /** No translation: this process re-raises no cause with a code of its own. */
  private readonly causes: TrpcCauseTranslation = { translate: () => undefined };

  private errorReporting(): TrpcErrorReporting {
    return {
      capture: (failure: unknown) => {
        this.logger.error({ error: failure }, "tRPC call failed");
      },
      asError: (failure: unknown): Error =>
        failure instanceof Error ? failure : new Error(String(failure)),
    };
  }

  /**
   * One mutation on the deployment's trail. A build that installed no audit log
   * says so once per call rather than dropping the row silently.
   */
  private async record(entry: {
    userId: string;
    organizationId?: string;
    projectId?: string;
    action: string;
    args?: unknown;
    error?: Error;
  }): Promise<void> {
    if (!this.auditLog) {
      this.logger.warn(
        { trail: "audit-log", action: entry.action },
        "A mutation went unrecorded: this process installed no audit-log module",
      );
      return;
    }

    const scopes = auditScopeIds(entry.args);
    const organizationId = entry.organizationId ?? scopes.organizationId;
    const projectId = entry.projectId ?? scopes.projectId;
    await this.auditLog.record(
      recordAuditLogCommandSchema.parse({
        userId: entry.userId,
        action: entry.action,
        args: entry.args === undefined ? undefined : JSON.parse(JSON.stringify(entry.args)),
        ...(organizationId === undefined ? {} : { organizationId }),
        ...(projectId === undefined ? {} : { projectId }),
        ...(entry.error ? { error: entry.error.toString() } : {}),
      }),
    );
  }
}

/**
 * What kind of procedure the composed router serves at a dotted path. The
 * stream lane asks it BEFORE it builds a caller, because a path this lane will
 * not serve should cost neither a session nor a context.
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
