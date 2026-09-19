/**
 * Where every declared tRPC namespace mounts: one root at `/api/trpc`, plus the
 * subscription lane at `/api/sse` over the SAME router, so a procedure is
 * reachable live exactly when it is reachable at all.
 *
 * tRPC IS session-authenticated. That is not settable by a deployment — it is
 * what this transport means — so the session reader is a required collaborator
 * and nothing upstream can omit or replace it.
 */
import { LiteMemberRestrictedError } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import type {
  FeatureTrpcHost,
  FeatureTrpcMountOptions,
  MountableTransport,
} from "@langwatch/kernel";
import { createLogger, type Logger } from "@langwatch/observability";
import type { AnyTRPCRouter } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import type { RateLimiter } from "../ports.ts";
import type { SessionCaller, SessionReader } from "../rest/credential.ts";
import {
  auditScopeIds,
  bindTrpcFact,
  browserSessionFact,
  callerAddressFact,
  createTrpcErrorFormatter,
  createTrpcRuntime,
  createTrpcRuntimePolicy,
  isAuditLogExempt,
  redactAuditArgs,
  trpcFailureTraceIds,
  TrpcRootDefinition,
  type TrpcAuthorizationDecisions,
  type TrpcAuthorizationDenial,
  type TrpcErrorCausePayload,
  type TrpcFactBinding,
  type TrpcMountOptions,
  type TrpcRequestLike,
  type TrpcRoot,
  type TrpcRuntime,
  type TrpcRuntimeMembers,
  type TrpcThrottle,
  type TrpcThrottlePolicy,
} from "./index.ts";

/** The signed-in person, as the procedures that render one read it. */
export type TrpcSessionUser = Readonly<{
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  role?: string | null;
  /** The real administrator when one is acting as this person. */
  impersonator?: TrpcSessionUser;
}>;

export type TrpcSession = Readonly<{
  user: TrpcSessionUser;
  /** The browser session's own id, where the deployment tracks one. */
  sessionId?: string;
}>;

/** The one context every procedure on this root is resolved against. */
export type TrpcRequestContext = {
  readonly req?: TrpcRequestLike | undefined;
  readonly res?: { statusCode?: number } | undefined;
  /**
   * Written by the declared authorization check, read by the fail-closed
   * backstop — starts false on EVERY request, so a carried-over flag cannot
   * pass a procedure because a different one was checked.
   */
  permissionChecked: boolean;
  organizationRole?: string | null;
  readonly session: TrpcSession | null;
  /** Replaced by the real one on the subscription lane; absent elsewhere. */
  readonly signal?: AbortSignal | undefined;
  /** Refuses an anonymous caller. The ONE definition of that refusal. */
  actor(): Readonly<{ id: string }>;
  /** The same answer, or nothing: the logger has to describe an anonymous caller. */
  tryActor(): Readonly<{ id: string }> | undefined;
  clientIp(): string | undefined;
};

/** Whatever this root made of one declared namespace. */
export type TrpcNamespace = unknown;

/** One mutation on the deployment's trail, as this transport leaves it. */
export type TrpcAuditSink = Readonly<{
  record(entry: {
    userId: string;
    organizationId?: string;
    projectId?: string;
    action: string;
    args?: unknown;
    error?: Error;
  }): Promise<void> | void;
}>;

/**
 * The caller still holds a membership in this organization, but an admin
 * disabled it to stay within the licensed seat count, so it grants nothing.
 */
export class MembershipDisabledError extends HandledError {
  declare readonly code: "membership_disabled";

  constructor() {
    super("membership_disabled", "Your access to this organization has been disabled", {
      httpStatus: 403,
      fault: "customer",
    });

    this.name = "MembershipDisabledError";
  }
}

/** This transport's own refusal copy: the two answers the declared check gives. */
const DENIALS: TrpcAuthorizationDenial = {
  membershipDisabled: () => new MembershipDisabledError(),
  liteMemberRestricted: (resource: string) => new LiteMemberRestrictedError(resource),
};

export class TrpcHost implements FeatureTrpcHost<TrpcNamespace> {
  /** The library's own place for tRPC. Not configuration, and not moveable. */
  static readonly path = "/api/trpc";

  /** The library's own place for the subscription lane over the same router. */
  static readonly streamPath = "/api/sse";

  static create(options: {
    /** Structural: this transport IS session-authenticated. */
    sessions: SessionReader;
    /** The SAME decisions REST authorizes through, never a second. */
    authz: TrpcAuthorizationDecisions;
    /** Where every recorded mutation lands. Absent, each one says so once. */
    audit?: TrpcAuditSink | undefined;
    /** The module-shaped cause payloads a browser interceptor reads. */
    errorCausePayload?: TrpcErrorCausePayload | undefined;
    /**
     * The counter throttled procedures count against, and the window each one
     * names by its wire path. A procedure the map does not name passes through.
     */
    throttle?:
      | Readonly<{ limiter: RateLimiter; policies: Readonly<Record<string, TrpcThrottlePolicy>> }>
      | undefined;
    /** What the process knows about a caller on every namespace at once. */
    facts?: readonly TrpcFactBinding<TrpcRequestContext>[] | undefined;
    logger?: Pick<Logger, "warn" | "error"> | undefined;
  }): TrpcHost {
    return new TrpcHost(options);
  }

  readonly #logger: Pick<Logger, "warn" | "error">;
  readonly #root: TrpcRoot<TrpcRequestContext>;
  readonly #runtime: TrpcRuntime<TrpcRequestContext>;
  readonly #namespaces: Record<string, TrpcNamespace> = {};
  readonly #options: Parameters<typeof TrpcHost.create>[0];
  #composed: AnyTRPCRouter | undefined;

  private constructor(options: Parameters<typeof TrpcHost.create>[0]) {
    this.#options = options;
    this.#logger = options.logger ?? createLogger("langwatch:api:trpc");

    this.#root = TrpcRootDefinition.forContext<TrpcRequestContext>().create({
      errorFormatter: createTrpcErrorFormatter({
        causePayload: options.errorCausePayload ?? { payloadFor: () => null },
        traceIds: trpcFailureTraceIds,
      }),
    });

    const policy = createTrpcRuntimePolicy<TrpcRequestContext, TrpcRequestContext>(this.#root, {
      identity: {
        authenticate: (ctx) => {
          (ctx as TrpcRequestContext).actor();

          return ctx as TrpcRequestContext;
        },
        actor: (ctx) => {
          const context = ctx as TrpcRequestContext;
          const actor = context.tryActor?.();
          if (!actor) return void 0;

          const impersonatorId = context.session?.user.impersonator?.id;

          return impersonatorId ? { id: actor.id, impersonatorId } : actor;
        },
      },
      audit: { record: (entry) => this.#record(entry) },
      errorReporting: {
        capture: (failure: unknown) => this.#logger.error({ error: failure }, "tRPC call failed"),
        asError: (failure: unknown): Error =>
          failure instanceof Error ? failure : new Error(String(failure)),
      },
      // This surface re-raises no cause with a code of its own.
      causes: { translate: () => void 0 },
    });

    this.#runtime = createTrpcRuntime<TrpcRequestContext>({
      root: this.#root as Parameters<typeof createTrpcRuntime<TrpcRequestContext>>[0]["root"],
      procedure: policy.authProtectedProcedure,
      anonymousProcedure: this.#root.procedure,
      members: this.#members(options),
    });
  }

  /** One declared namespace on this root. The process's own facts come first. */
  mount(
    declaration: MountableTransport,
    app: () => unknown,
    options?: FeatureTrpcMountOptions,
  ): TrpcNamespace {
    if (this.#composed) {
      throw new Error("The tRPC root was composed; a namespace can no longer be mounted on it.");
    }

    const mount = this.#runtime.mount as unknown as (
      declaration: MountableTransport,
      app: (ctx: TrpcRequestContext) => unknown,
      options?: TrpcMountOptions<TrpcRequestContext>,
    ) => TrpcNamespace;

    const namespace = namespaceOf(declaration);

    const mounted = mount(declaration, () => app(), {
      facts: [
        ...this.#processFacts(),
        ...((options?.facts ?? []) as readonly TrpcFactBinding<TrpcRequestContext>[]),
      ],
    });

    this.#namespaces[namespace] = mounted;

    return mounted;
  }

  /**
   * The root over every namespace, composed on first read. Composing then
   * rather than at each mount is what makes a batched call spanning two
   * namespaces work: every namespace has mounted by the time anything asks.
   */
  get router(): AnyTRPCRouter {
    this.#composed ??= this.#runtime.router(this.#namespaces) as AnyTRPCRouter;

    return this.#composed;
  }

  /**
   * What kind of procedure this root serves at a dotted path. The stream lane
   * asks BEFORE it builds a caller, because a path it will not serve should
   * cost neither a session nor a context.
   */
  procedureTypeAt(path: string): "query" | "mutation" | "subscription" | undefined {
    const procedures: Record<string, { _def?: { type?: unknown } } | undefined> =
      this.router._def.procedures;

    const type = procedures[path]?._def?.type;

    return type === "query" || type === "mutation" || type === "subscription" ? type : void 0;
  }

  /** One request, resolved into the context every procedure reads. */
  async context(input: {
    request: Request;
    /** Resolved ONCE at the door, behind this deployment's own proxies. */
    address?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<TrpcRequestContext> {
    const { request, address, signal } = input;
    const caller = await this.#options.sessions.read(request);
    const session = sessionOf(caller);
    const authenticated = session ? { id: session.user.id } : null;

    const req: TrpcRequestLike = {
      headers: Object.fromEntries(request.headers),
      ...(address ? { socket: { remoteAddress: address } } : {}),
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
      tryActor: () => authenticated ?? void 0,
      clientIp: () => address,
    };
  }

  /**
   * What this process knows about a caller that no module can. The two facts
   * the tRPC toolkit publishes are bound for EVERY namespace, because they
   * describe the request rather than the feature answering it.
   */
  #processFacts(): readonly TrpcFactBinding<TrpcRequestContext>[] {
    return [
      bindTrpcFact(browserSessionFact, (ctx: TrpcRequestContext) => ctx.session?.sessionId ?? null),
      bindTrpcFact(callerAddressFact, (ctx: TrpcRequestContext) => ctx.clientIp() ?? null),
      ...(this.#options.facts ?? []),
    ];
  }

  #members(options: Parameters<typeof TrpcHost.create>[0]): TrpcRuntimeMembers<TrpcRequestContext> {
    return {
      identity: {
        caller: (ctx) => {
          const actor = ctx.tryActor?.();
          const impersonatorId = ctx.session?.user.impersonator?.id;

          return {
            actor: actor
              ? {
                  type: "user" as const,
                  id: actor.id,
                  ...(impersonatorId ? { impersonatorId } : {}),
                }
              : null,
          };
        },
      },
      authorization: { forRequest: () => options.authz },
      denials: DENIALS,
      ...(options.throttle ? { throttle: throttleOf(options.throttle) } : {}),
      audit: {
        record: (entry) => this.#record(entry),
        redact: ({ procedure, args }) => redactAuditArgs({ input: args, action: procedure }),
        exempt: (procedure) => isAuditLogExempt(procedure),
      },
      errors: {
        report: (failure) => this.#logger.error({ error: failure }, "tRPC call failed"),
        asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
        translate: () => void 0,
      },
    };
  }

  /**
   * One mutation on the deployment's trail. A build that installed no audit
   * sink says so once per call rather than dropping the row silently.
   */
  async #record(entry: {
    userId: string;
    organizationId?: string;
    projectId?: string;
    action: string;
    args?: unknown;
    error?: Error;
  }): Promise<void> {
    const audit = this.#options.audit;

    if (!audit) {
      this.#logger.warn(
        { trail: "audit-log", action: entry.action },
        "A mutation went unrecorded: this process installed no audit-log module",
      );

      return;
    }

    const scopes = auditScopeIds(entry.args);
    const organizationId = entry.organizationId ?? scopes.organizationId;
    const projectId = entry.projectId ?? scopes.projectId;

    await audit.record({
      userId: entry.userId,
      action: entry.action,
      ...(entry.args === void 0 ? {} : { args: entry.args }),
      ...(organizationId === void 0 ? {} : { organizationId }),
      ...(projectId === void 0 ? {} : { projectId }),
      ...(entry.error ? { error: entry.error } : {}),
    });
  }
}

/** The session a resolved caller stands for, in the shape procedures read. */
function sessionOf(caller: SessionCaller | null): TrpcSession | null {
  if (!caller?.userId) return null;

  return {
    user: {
      id: caller.userId,
      name: caller.name ?? null,
      email: caller.email ?? null,
      image: caller.image ?? null,
      ...(caller.impersonator?.id
        ? {
            impersonator: {
              id: caller.impersonator.id,
              name: caller.impersonator.name ?? null,
              email: caller.impersonator.email ?? null,
              image: caller.impersonator.image ?? null,
            },
          }
        : {}),
    },
    ...(caller.sessionId ? { sessionId: caller.sessionId } : {}),
  };
}

/**
 * The surface's one throttle: the caller is the actor the check resolved or the
 * address the request came from, and the counting is the process limiter's.
 */
function throttleOf(config: {
  limiter: RateLimiter;
  policies: Readonly<Record<string, TrpcThrottlePolicy>>;
}): TrpcThrottle<TrpcRequestContext> {
  return {
    policyFor: ({ procedure }) => Promise.resolve(config.policies[procedure]),
    principalOf: (ctx) => ctx.tryActor()?.id ?? ctx.clientIp() ?? "anonymous",
    check: ({ key, policy }) => config.limiter.check(key, policy),
  };
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

  throw new Error("A tRPC declaration reached the tRPC surface with no namespace.");
}

