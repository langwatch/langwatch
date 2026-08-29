/**
 * The back office's single sign-on connection surface (D05 tier 1).
 *
 * tRPC rather than the flat REST admin API for one reason: every change to a
 * connection is a GUARDED COMMAND with the operator recorded on it, and the
 * REST surface is `ra-data-simple-prisma` writing table rows. There is no shape
 * of that surface which could carry a lifecycle verb, and a raw row write here
 * would be overwritten by the next fold anyway.
 *
 * Gating is the back office's existing gating, unchanged: the `ADMIN_EMAILS`
 * staff list plus an in-handler `isAdmin`, deliberately NOT `ops:*`. `ops` is
 * the registry's only platform-scope resource and never reaches the tRPC
 * `.permission()` surface at all; more to the point, if `ops` ever widens to a
 * broader operator population, who may attest a customer's domain must not
 * widen with it by accident. So every procedure carries an explicit opt-out
 * declaration with that reason and checks the admin list itself.
 *
 * Denial is a 404 built from `AdminSurfaceHiddenError` — byte-identical to an
 * unregistered path, so the surface does not confirm its own existence to a
 * prober. That is why this file throws the shared error rather than a
 * `TRPCError({ code: "FORBIDDEN" })`.
 *
 * The guards underneath refuse a second time, and differently: the admin list
 * decides who reaches the surface, and the platform-operator port decides whose
 * hand may approve a claim or attest a domain. Both are the same list today.
 * They are two checks because they answer two questions, and the second one
 * holds for callers that never came through here.
 *
 * Transport only: gating, audit, and delegation to the process's back-office
 * service.
 *
 * Spec: specs/identity/sso-onboarding-tiers.feature.
 */
import { AdminSurfaceHiddenError, type OpsService } from "@langwatch/ops-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/** The operator issuing a command, as the surface knows them. */
type OperatorActor = Readonly<{ userId: string }>;

/**
 * What the back office reads and commands. Structural rather than imported:
 * the service is the process's, composed over its own identity storage, and
 * this surface only ever gates it and hands the operator through.
 */
type SsoConnectionBackoffice = Readonly<{
  list(input: { page: number; pageSize: number; search?: string }): Promise<unknown>;
  getById(input: { connectionId: string }): Promise<unknown>;
  registerConnection(input: {
    organizationId: string;
    type: string;
    providerId: string;
    issuer: string | null;
    allowsJit: boolean;
    operator: OperatorActor;
  }): Promise<unknown>;
  claimDomain(input: {
    organizationId: string;
    connectionId: string;
    domain: string;
    operator: OperatorActor;
  }): Promise<void>;
  approveDomainClaim(input: {
    organizationId: string;
    connectionId: string;
    domain: string;
    operator: OperatorActor;
  }): Promise<void>;
  rejectDomainClaim(input: {
    organizationId: string;
    connectionId: string;
    domain: string;
    note: string;
    operator: OperatorActor;
  }): Promise<void>;
  attestDomain(input: {
    organizationId: string;
    connectionId: string;
    domain: string;
    operator: OperatorActor;
  }): Promise<void>;
  activateConnection(input: {
    organizationId: string;
    connectionId: string;
    testLoginAccountId: string;
    operator: OperatorActor;
  }): Promise<void>;
  suspendConnection(input: {
    organizationId: string;
    connectionId: string;
    reason: string | null;
    operator: OperatorActor;
  }): Promise<void>;
  resumeConnection(input: {
    organizationId: string;
    connectionId: string;
    operator: OperatorActor;
  }): Promise<void>;
  requestTeardown(input: {
    organizationId: string;
    connectionId: string;
    reason: string | null;
    graceMs: number;
    operator: OperatorActor;
  }): Promise<void>;
}>;

/** The staff identity the admin list is checked against. */
type StaffIdentity = Readonly<{ id: string; email?: string | null }>;

/**
 * The process supplies authentication and the staff list; this surface reads
 * the impersonator rather than the impersonated user, because an operator
 * debugging a customer account is still the operator here.
 */
export type SsoConnectionTrpcContext = Readonly<{
  app: Readonly<{ ops: OpsService }>;
  actor(): Readonly<{ id: string }>;
  session: Readonly<{
    user: StaffIdentity & Readonly<{ impersonator?: StaffIdentity | null }>;
  }> | null;
}>;

type SsoConnectionTrpcProcedures<
  TContext extends SsoConnectionTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage and audit chain
   * carrying an explicit opt-out of the RBAC check, with the reason that this
   * surface is gated on the staff list and is cross-tenant by design. Applied
   * AFTER this feature's own input parser, as every declared check is.
   */
  staffPolicy<TProcedure>(procedure: TProcedure): TProcedure;
  /**
   * The same opt-out for the verbs whose input names an organization, allowing
   * `organizationId` with its own written reason: the id is NOT what decides
   * the caller's reach here. An operator on the staff list may act on any
   * organization, and one who is not may act on none — so `organizationId` is
   * routing, saying which tenant's history the command is appended to, and it
   * is never read as a scope the caller was granted.
   */
  staffPolicyForOrganization<TProcedure>(procedure: TProcedure): TProcedure;
}>;

/** The process capabilities this transport needs that are not SSO's own. */
export type SsoConnectionTrpcPorts = Readonly<{
  /** The process's back-office reader and command sender. */
  backoffice(): SsoConnectionBackoffice;
  /** The process's audit trail. */
  recordAudit(
    entry: Readonly<{
      userId: string;
      action: string;
      args: Readonly<Record<string, unknown>>;
      targetKind: string;
      targetId?: string;
    }>,
  ): Promise<void>;
}>;

/**
 * How long a removal stays reversible before the process manager completes it.
 * Seven days: long enough that a mistaken teardown is noticed by somebody
 * signing in on a Monday, short enough that a connection nobody wants does not
 * linger routing.
 */
const TEARDOWN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const connectionTarget = z.object({
  organizationId: z.string().min(1),
  connectionId: z.string().min(1),
});

const domainTarget = connectionTarget.extend({
  domain: z.string().min(1).max(253),
});

/** Installs the complete `ssoConnections.*` surface on a process-owned root. */
export class SsoConnectionTrpcApi {
  static create<
    TContext extends SsoConnectionTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TPorts extends SsoConnectionTrpcPorts,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SsoConnectionTrpcProcedures<TContext, TOptions, TRoot>,
    ports: TPorts,
  ) {
    const { protected: procedure, staffPolicy, staffPolicyForOrganization } = procedures;

    /** The operator, or a 404 that says nothing about why. */
    // The CONSTRAINT, not the type parameter: tRPC hands a resolver a
    // `Simplify<TContext>`, which satisfies the constraint but is not
    // assignable to `TContext` itself. Neither helper reads anything past the
    // constraint.
    const requireOperator = (ctx: SsoConnectionTrpcContext): OperatorActor => {
      // `actor()` is the process's refusal for a request carrying no caller;
      // it throws before the fallback below can be reached.
      const caller = ctx.actor();
      const user = ctx.session?.user;
      // Annotated, because the actor fallback carries no address and the
      // staff list is checked on one: a request with no session resolves to
      // an identity that cannot be an operator, which is the refusal this
      // surface wants and not an accident of inference.
      const staff: StaffIdentity = user?.impersonator ?? user ?? caller;
      if (!ctx.app.ops.isAdmin(staff)) throw new AdminSurfaceHiddenError();
      return { userId: staff.id };
    };

    /**
     * Gate and record in one move. Every mutation on this surface is
     * cross-tenant and every one of them changes how somebody signs in, so the
     * audit row is written BEFORE the command — an operator asking "why did
     * this happen at 03:14" needs the attempt, not only the successes.
     */
    const audited = async ({
      ctx,
      action,
      args,
    }: {
      ctx: SsoConnectionTrpcContext;
      action: string;
      args: Record<string, unknown>;
    }): Promise<OperatorActor> => {
      const operator = requireOperator(ctx);
      await ports.recordAudit({
        userId: operator.userId,
        action: `ssoConnections.${action}`,
        args,
        targetKind: "ssoConnection",
        targetId: typeof args.connectionId === "string" ? args.connectionId : undefined,
      });
      return operator;
    };

    return trpc.router({
      getAll: staffPolicy(
        procedure.input(
          z.object({
            page: z.number().int().min(0).default(0),
            pageSize: z.number().int().min(1).max(100).default(25),
            search: z.string().max(253).optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        const operator = requireOperator(ctx);
        await ports.recordAudit({
          userId: operator.userId,
          action: "ssoConnections.getAll",
          args: {
            page: input.page,
            pageSize: input.pageSize,
            hasSearch: Boolean(input.search),
          },
          targetKind: "ssoConnection",
        });
        return ports.backoffice().list(input);
      }),

      getById: staffPolicy(procedure.input(z.object({ connectionId: z.string().min(1) }))).query(
        async ({ ctx, input }) => {
          const operator = requireOperator(ctx);
          await ports.recordAudit({
            userId: operator.userId,
            action: "ssoConnections.getById",
            args: { connectionId: input.connectionId },
            targetKind: "ssoConnection",
            targetId: input.connectionId,
          });
          return ports.backoffice().getById(input);
        },
      ),

      register: staffPolicyForOrganization(
        procedure.input(
          z.object({
            organizationId: z.string().min(1),
            // The union the aggregate speaks, so a SAML request reaches the
            // service and is refused BY NAME. Narrowing it to `"oidc"` here
            // would answer a validation error instead, which tells the operator
            // the field is wrong rather than that the protocol is not
            // self-serve yet.
            type: z.enum(["oidc", "saml"]),
            providerId: z.string().min(1).max(100),
            issuer: z.string().max(2048).nullable().default(null),
            allowsJit: z.boolean().default(false),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const operator = await audited({ ctx, action: "register", args: input });
        return ports.backoffice().registerConnection({ ...input, operator });
      }),

      claimDomain: staffPolicyForOrganization(procedure.input(domainTarget)).mutation(
        async ({ ctx, input }) => {
          const operator = await audited({
            ctx,
            action: "claimDomain",
            args: input,
          });
          await ports.backoffice().claimDomain({ ...input, operator });
        },
      ),

      approveDomainClaim: staffPolicyForOrganization(procedure.input(domainTarget)).mutation(
        async ({ ctx, input }) => {
          const operator = await audited({
            ctx,
            action: "approveDomainClaim",
            args: input,
          });
          await ports.backoffice().approveDomainClaim({ ...input, operator });
        },
      ),

      rejectDomainClaim: staffPolicyForOrganization(
        procedure.input(domainTarget.extend({ note: z.string().min(1).max(1000) })),
      ).mutation(async ({ ctx, input }) => {
        const operator = await audited({
          ctx,
          action: "rejectDomainClaim",
          args: { ...input, note: undefined },
        });
        await ports.backoffice().rejectDomainClaim({ ...input, operator });
      }),

      attestDomain: staffPolicyForOrganization(procedure.input(domainTarget)).mutation(
        async ({ ctx, input }) => {
          const operator = await audited({
            ctx,
            action: "attestDomain",
            args: input,
          });
          await ports.backoffice().attestDomain({ ...input, operator });
        },
      ),

      activate: staffPolicyForOrganization(
        procedure.input(connectionTarget.extend({ testLoginAccountId: z.string().min(1) })),
      ).mutation(async ({ ctx, input }) => {
        const operator = await audited({ ctx, action: "activate", args: input });
        await ports.backoffice().activateConnection({ ...input, operator });
      }),

      suspend: staffPolicyForOrganization(
        procedure.input(
          connectionTarget.extend({
            reason: z.string().min(1).max(1000).nullable().default(null),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const operator = await audited({ ctx, action: "suspend", args: input });
        await ports.backoffice().suspendConnection({ ...input, operator });
      }),

      resume: staffPolicyForOrganization(procedure.input(connectionTarget)).mutation(
        async ({ ctx, input }) => {
          const operator = await audited({ ctx, action: "resume", args: input });
          await ports.backoffice().resumeConnection({ ...input, operator });
        },
      ),

      requestTeardown: staffPolicyForOrganization(
        procedure.input(
          connectionTarget.extend({
            reason: z.string().min(1).max(1000).nullable().default(null),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const operator = await audited({
          ctx,
          action: "requestTeardown",
          args: input,
        });
        await ports.backoffice().requestTeardown({
          ...input,
          operator,
          graceMs: TEARDOWN_GRACE_MS,
        });
      }),
    });
  }
}
