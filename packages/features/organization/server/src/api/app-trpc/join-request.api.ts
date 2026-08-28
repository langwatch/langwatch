/**
 * Joining an organization (D12, ADR-117) over the process's tRPC transport:
 * the lookup, the ask, the two admin answers, and the setting behind them.
 * `invite` and `membership` are organization subjects, and so is the request
 * that precedes one, which is why this surface belongs to the organization
 * feature.
 *
 * The reveal discipline is the whole design of this file, and it is enforced
 * by what the procedures ACCEPT rather than by what they return.
 *
 * `lookup` takes NO address. It reads the caller's own verified identifiers
 * and answers about those, so there is no input a caller can vary to probe
 * for other people's organizations — the one shape that makes this endpoint
 * safe to expose at all. `request` re-derives the offer server-side for the
 * same reason: naming an organization that was never offered is refused
 * exactly as an organization that does not exist is, and both come back as
 * `join_not_available`.
 *
 * The requester-side procedures declare no permission deliberately. There is
 * no permission to hold — the caller is asking to join an organization they
 * are by definition not in yet — so the handler proves what it needs itself:
 * the address is the session's own and verified, and the organization is one
 * the matcher offered. The admin-side procedures take `organization:manage`,
 * the same permission that gates inviting, because approving a request and
 * sending an invitation are the same authority.
 *
 * Transport only: gates and delegation to the process's join-request service,
 * which is composed over the identity ledger, the membership writer and the
 * mailer.
 */
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import {
  DOMAIN_JOIN_SETTINGS,
  type DomainJoinSetting,
  type JoinLookupDecision,
  type JoinRequestAggregateState,
} from "@langwatch/identity";
import {
  joinRequestApiDecisionInputSchema,
  joinRequestApiOrganizationScopeSchema,
  joinRequestApiRequestInputSchema,
  joinRequestApiWithdrawInputSchema,
} from "@langwatch/organization-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

/** The process supplies authentication; authorization arrives as `policy`. */
export type JoinRequestTrpcContext = Readonly<{
  actor(): Readonly<{ id: string }>;
}>;

type JoinRequestTrpcProcedures<
  TContext extends JoinRequestTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one access declaration.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The process capabilities this transport needs.
 *
 * The join-request service itself is the process's: it is composed over the
 * identity ledger, a membership writer that emits authorization grants, the
 * organization's join settings and the mailer, none of which the organization
 * feature owns.
 */
export type JoinRequestTrpcPorts = Readonly<{
  /**
   * Which organizations are open to this address. Every closed door — an
   * unverified address, a consumer mail domain, an organization that turned
   * joining off, and one that does not exist — is the same answer.
   */
  lookup(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{ userId: string; verifiedEmail: string | null }>,
  ): Promise<JoinLookupDecision>;
  pendingForUser(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{ userId: string }>,
  ): Promise<readonly JoinRequestAggregateState[]>;
  request(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{
      userId: string;
      verifiedEmail: string | null;
      organizationId: string;
    }>,
  ): Promise<Readonly<{ joinRequestId: string; state: "PENDING" | "APPROVED" }>>;
  withdraw(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{ joinRequestId: string; userId: string }>,
  ): Promise<unknown>;
  pendingForOrganization(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly JoinRequestAggregateState[]>;
  approve(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{
      joinRequestId: string;
      organizationId: string;
      adminUserId: string;
    }>,
  ): Promise<unknown>;
  reject(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{
      joinRequestId: string;
      organizationId: string;
      adminUserId: string;
    }>,
  ): Promise<unknown>;
  readJoining(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{ organizationId: string }>,
  ): Promise<Readonly<{ domainJoin: DomainJoinSetting; joinDomains: string[] }>>;
  setJoining(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{
      organizationId: string;
      domainJoin: DomainJoinSetting;
      domains: readonly string[];
    }>,
  ): Promise<Readonly<{ previous: DomainJoinSetting; next: DomainJoinSetting }>>;
  /**
   * The caller's own verified address, and the reason every requester-side
   * procedure starts here. A user who is not on identifiers yet falls back to
   * the legacy column, but only where it is marked verified; an unverified
   * address answers null, and every caller treats that as the universal
   * nothing.
   */
  tryResolveVerifiedEmail(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{ userId: string }>,
  ): Promise<string | null>;
  /** Display names for the requesters on an organization's pending list. */
  listUserNames(
    ctx: JoinRequestTrpcContext,
    input: Readonly<{ userIds: readonly string[] }>,
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]>;
}>;

const ORGANIZATION_MANAGE: AuthzDeclaration = {
  kind: "permission",
  permission: "organization:manage",
};

const NOT_A_MEMBER_YET: AuthzDeclaration = {
  kind: "no-permission",
  reason:
    "the caller is asking about organizations they are not in yet, so there is no scope to hold a permission on; the handler answers only for the session's OWN verified addresses and reveals nothing else",
};

const OWN_PENDING_REQUESTS: AuthzDeclaration = {
  kind: "no-permission",
  reason: "the caller's own pending requests, keyed by their session id",
};

const OFFERED_ORGANIZATION_ONLY: AuthzDeclaration = {
  kind: "no-permission",
  reason:
    "asking to join is the one action a non-member takes on an organization; the handler proves the organization was OFFERED to this caller's verified domain and refuses anything else as if it did not exist",
  allow: { organizationId: "the organization the matcher offered" },
};

const OWN_REQUEST_ONLY: AuthzDeclaration = {
  kind: "no-permission",
  // No `allow` map: `joinRequestId` is not a scope id, and the handler
  // refuses a request that is not the caller's as if it did not exist.
  reason: "the requester withdrawing their own request, matched on the session's user id",
};

/**
 * The one input this surface still builds locally. Its `domainJoin` values are
 * `DOMAIN_JOIN_SETTINGS`, which the identity package owns; restating those
 * three words in the organization contract would be a second source of truth
 * for them, so the shape stays where the constant is in scope. Every other
 * input on this surface lives in `join-request.api.ts` in the contract.
 */
const setJoiningInputSchema = z.object({
  organizationId: z.string().min(1),
  domainJoin: z.enum(DOMAIN_JOIN_SETTINGS),
  domains: z.array(z.string().min(1)).default([]),
});

/** One waiting request, as both pending lists render it. */
function waitingSince(request: JoinRequestAggregateState) {
  return {
    joinRequestId: request.joinRequestId,
    requestedAt: new Date(request.createdAtMs),
    expiresAt: request.expiresAtMs === null ? null : new Date(request.expiresAtMs),
  };
}

/**
 * Installs the complete `joinRequests.*` tRPC surface on a process-owned root.
 * The procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
export class JoinRequestTrpcApi {
  static create<
    TContext extends JoinRequestTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: JoinRequestTrpcProcedures<TContext, TOptions, TRoot>,
    ports: JoinRequestTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * Which organizations are open to one of the caller's own verified
       * addresses. Answers "none" for every closed door — an unverified
       * address, a consumer mail domain, an organization that turned joining
       * off, and one that does not exist are all one answer.
       */
      lookup: policy(NOT_A_MEMBER_YET)(procedure).query(
        async ({ ctx }): Promise<JoinLookupDecision> => {
          const userId = ctx.actor().id;
          return ports.lookup(ctx, {
            userId,
            verifiedEmail: await ports.tryResolveVerifiedEmail(ctx, { userId }),
          });
        },
      ),

      /**
       * Everything this person is waiting on, so a screen can say so rather
       * than offering them an organization they have already asked.
       */
      mine: policy(OWN_PENDING_REQUESTS)(procedure).query(async ({ ctx }) => {
        const pending = await ports.pendingForUser(ctx, { userId: ctx.actor().id });
        return pending.map((request) => ({
          ...waitingSince(request),
          organizationId: request.organizationId,
        }));
      }),

      /** Ask one organization to let you in. */
      request: policy(OFFERED_ORGANIZATION_ONLY)(
        procedure.input(joinRequestApiRequestInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const userId = ctx.actor().id;
        return ports.request(ctx, {
          userId,
          verifiedEmail: await ports.tryResolveVerifiedEmail(ctx, { userId }),
          organizationId: input.organizationId,
        });
      }),

      /** Give up on a request, so nobody is bothered further. */
      withdraw: policy(OWN_REQUEST_ONLY)(
        procedure.input(joinRequestApiWithdrawInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ports.withdraw(ctx, {
          joinRequestId: input.joinRequestId,
          userId: ctx.actor().id,
        });
        return { success: true };
      }),

      /** What is waiting on this organization, for the members area. */
      pending: policy(ORGANIZATION_MANAGE)(
        procedure.input(joinRequestApiOrganizationScopeSchema),
      ).query(async ({ ctx, input }) => {
        const pending = await ports.pendingForOrganization(ctx, {
          organizationId: input.organizationId,
        });
        // Who is asking, by name. The requester's ADDRESS is deliberately
        // not returned: the domain is what was matched and what the admin is
        // deciding on, and the local part is not the organization's business
        // until the person is a member.
        const names = await ports.listUserNames(ctx, {
          userIds: pending.map((request) => request.userId),
        });
        const nameById = new Map(names.map((user) => [user.id, user.name]));

        return pending.map((request) => ({
          ...waitingSince(request),
          userId: request.userId,
          name: nameById.get(request.userId) ?? "A colleague",
          domain: request.domain,
        }));
      }),

      /**
       * Approve. No role on this input and never will be: an approval grants
       * the organization's default role, and an admin who wants to hand over
       * more sends a formal invitation, which is the flow that owns roles and
       * teams.
       */
      approve: policy(ORGANIZATION_MANAGE)(
        procedure.input(joinRequestApiDecisionInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ports.approve(ctx, {
          joinRequestId: input.joinRequestId,
          organizationId: input.organizationId,
          adminUserId: ctx.actor().id,
        });
        return { success: true };
      }),

      /**
       * Reject. No reason field: an admin who has to justify a refusal is an
       * admin who hesitates to make one.
       */
      reject: policy(ORGANIZATION_MANAGE)(
        procedure.input(joinRequestApiDecisionInputSchema),
      ).mutation(async ({ ctx, input }) => {
        await ports.reject(ctx, {
          joinRequestId: input.joinRequestId,
          organizationId: input.organizationId,
          adminUserId: ctx.actor().id,
        });
        return { success: true };
      }),

      /**
       * How colleagues on a matching domain currently get in, for the settings
       * card. Behind `organization:manage` like the write: an organization's
       * joining posture is not a stranger's business.
       */
      joining: policy(ORGANIZATION_MANAGE)(
        procedure.input(joinRequestApiOrganizationScopeSchema),
      ).query(async ({ ctx, input }) =>
        ports.readJoining(ctx, { organizationId: input.organizationId }),
      ),

      /** How colleagues on a matching domain get in. */
      setJoining: policy(ORGANIZATION_MANAGE)(procedure.input(setJoiningInputSchema)).mutation(
        async ({ ctx, input }) =>
          ports.setJoining(ctx, {
            organizationId: input.organizationId,
            domainJoin: input.domainJoin,
            domains: input.domains,
          }),
      ),
    });
  }
}
