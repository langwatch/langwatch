/**
 * Joining an organization (D12, ADR-117) over tRPC. Reveal discipline lives in what procedures
 * accept, not return: `lookup` takes no address, reading only the caller's own identifiers.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import type { AuthzDeclaration } from "@langwatch/authz-contract";
import {
  DOMAIN_JOIN_SETTINGS,
  type DomainJoinSetting,
  type JoinLookupDecision,
  type JoinRequestAggregateState,
} from "@langwatch/identity-contract";
import {
  joinRequestApiDecisionInputSchema,
  joinRequestApiOrganizationScopeSchema,
  joinRequestApiRequestInputSchema,
  joinRequestApiWithdrawInputSchema,
  joinRequestFiledSchema,
  joinRequestJoiningChangedSchema,
  joinRequestJoiningSchema,
  joinRequestMineSchema,
  joinRequestPendingSchema,
  joinRequestWriteAckSchema,
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
  /** The process's tracing/logging/error/authorization/audit policy for one access declaration.
   * Applied after this feature's own input parser, since the check reads its scope id from it. */
  policy(declaration: AuthzDeclaration): <TProcedure>(procedure: TProcedure) => TProcedure;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/**
 * The process capabilities this transport needs — the join-request service is composed over
 * the identity ledger, a grant-emitting membership writer, join settings and the mailer.
 */
export type JoinRequestTrpcPorts = Readonly<{
  /** Which organizations are open to this address — every closed door reads the same. */
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
  /** The caller's own verified address, falling back to the legacy column only when marked
   * verified; an unverified address answers null, treated as the universal nothing. */
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

/** The one input this surface still builds locally, since `domainJoin`'s `DOMAIN_JOIN_SETTINGS`
 * values are owned by the identity package, not restated in the organization contract. */
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
 * Installs the complete `joinRequests.*` tRPC surface on a process-owned root. The procedure and
 * policy are injected so the process's auth/audit/error/logging/tracing wrap every procedure.
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
    const { protected: procedure, policy, validateOutput } = procedures;

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput,
      })
        /** Which organizations are open to the caller's own verified addresses — every closed
         * door, unverified, consumer domain, joining off, or nonexistent, is the same answer. */
        .query("lookup", (p) =>
          p
            .withoutInput("the caller's own session identifies the addresses to check")
            // The identity feature owns the join-matching decision's shape;
            // this transport forwards it untouched.
            .withoutOutput(
              "the identity feature owns the join-matching decision's shape (JoinLookupDecision)",
            )
            .withPermission(NOT_A_MEMBER_YET)
            .handle(async ({ ctx }): Promise<JoinLookupDecision> => {
              const userId = ctx.actor().id;
              return ports.lookup(ctx, {
                userId,
                verifiedEmail: await ports.tryResolveVerifiedEmail(ctx, { userId }),
              });
            }),
        )
        /**
         * Everything this person is waiting on, so a screen can say so rather
         * than offering them an organization they have already asked.
         */
        .query("mine", (p) =>
          p
            .withoutInput("the caller's own session identifies whose requests to list")
            .withOutput(joinRequestMineSchema)
            .withPermission(OWN_PENDING_REQUESTS)
            .handle(async ({ ctx }) => {
              const pending = await ports.pendingForUser(ctx, { userId: ctx.actor().id });
              return pending.map((request) => ({
                ...waitingSince(request),
                organizationId: request.organizationId,
              }));
            }),
        )
        /** Ask one organization to let you in. */
        .mutation("request", (p) =>
          p
            .withInput(joinRequestApiRequestInputSchema)
            .withOutput(joinRequestFiledSchema)
            .withPermission(OFFERED_ORGANIZATION_ONLY)
            .handle(async ({ ctx, input }) => {
              const userId = ctx.actor().id;
              return ports.request(ctx, {
                userId,
                verifiedEmail: await ports.tryResolveVerifiedEmail(ctx, { userId }),
                organizationId: input.organizationId,
              });
            }),
        )
        /** Give up on a request, so nobody is bothered further. */
        .mutation("withdraw", (p) =>
          p
            .withInput(joinRequestApiWithdrawInputSchema)
            .withOutput(joinRequestWriteAckSchema)
            .withPermission(OWN_REQUEST_ONLY)
            .handle(async ({ ctx, input }) => {
              await ports.withdraw(ctx, {
                joinRequestId: input.joinRequestId,
                userId: ctx.actor().id,
              });
              return { success: true };
            }),
        )
        /** What is waiting on this organization, for the members area. */
        .query("pending", (p) =>
          p
            .withInput(joinRequestApiOrganizationScopeSchema)
            .withOutput(joinRequestPendingSchema)
            .withPermission(ORGANIZATION_MANAGE)
            .handle(async ({ ctx, input }) => {
              const pending = await ports.pendingForOrganization(ctx, {
                organizationId: input.organizationId,
              });
              // Who is asking, by name — the requester's address is deliberately not returned,
              // since the local part isn't the organization's business until they're a member.
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
        )
        /** Approve: no role on this input, ever — it grants the default role; more goes through
         * a formal invitation instead. */
        .mutation("approve", (p) =>
          p
            .withInput(joinRequestApiDecisionInputSchema)
            .withOutput(joinRequestWriteAckSchema)
            .withPermission(ORGANIZATION_MANAGE)
            .handle(async ({ ctx, input }) => {
              await ports.approve(ctx, {
                joinRequestId: input.joinRequestId,
                organizationId: input.organizationId,
                adminUserId: ctx.actor().id,
              });
              return { success: true };
            }),
        )
        /**
         * Reject. No reason field: an admin who has to justify a refusal is an
         * admin who hesitates to make one.
         */
        .mutation("reject", (p) =>
          p
            .withInput(joinRequestApiDecisionInputSchema)
            .withOutput(joinRequestWriteAckSchema)
            .withPermission(ORGANIZATION_MANAGE)
            .handle(async ({ ctx, input }) => {
              await ports.reject(ctx, {
                joinRequestId: input.joinRequestId,
                organizationId: input.organizationId,
                adminUserId: ctx.actor().id,
              });
              return { success: true };
            }),
        )
        /**
         * How colleagues on a matching domain currently get in, for the settings
         * card. Behind `organization:manage` like the write: an organization's
         * joining posture is not a stranger's business.
         */
        .query("joining", (p) =>
          p
            .withInput(joinRequestApiOrganizationScopeSchema)
            .withOutput(joinRequestJoiningSchema)
            .withPermission(ORGANIZATION_MANAGE)
            .handle(({ ctx, input }) =>
              ports.readJoining(ctx, { organizationId: input.organizationId }),
            ),
        )
        /** How colleagues on a matching domain get in. */
        .mutation("setJoining", (p) =>
          p
            .withInput(setJoiningInputSchema)
            .withOutput(joinRequestJoiningChangedSchema)
            .withPermission(ORGANIZATION_MANAGE)
            .handle(({ ctx, input }) =>
              ports.setJoining(ctx, {
                organizationId: input.organizationId,
                domainJoin: input.domainJoin,
                domains: input.domains,
              }),
            ),
        )
        .build()
    );
  }
}
