/**
 * The server half of `identity.joinRequests.*`. Half runs outside membership,
 * since asking to join is done by someone not in the organization yet; those
 * handlers reveal nothing about an organization that did not offer itself.
 */

import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";
import {
  type IdentityDomainAdmission,
  type JoinLookupDecision,
  type JoinRequestAdmitted,
  type JoinRequestApiOrigin,
  type JoinRequestAutomaticJoins,
  type JoinRequestFiled,
  type JoinRequestJoining,
  type JoinRequestJoiningChanged,
  type JoinRequestMine,
  type JoinRequestPending,
  joinRequestTrpc,
} from "@langwatch/identity-contract";
import { moduleApi } from "@langwatch/module";

type OwnCall = Readonly<{ userId: string }>;
type OrganizationCall = Readonly<{ organizationId: string }>;
type Decision = Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>;

/** What each `identity.joinRequests.*` handler asks of identity's own join door. */
export interface JoinRequestDoor {
  lookup(input: OwnCall): Promise<JoinLookupDecision>;
  offer(input: OwnCall): Promise<JoinLookupDecision>;
  dismissOffer(input: OwnCall): Promise<void>;
  admitAutomatically(
    input: OwnCall & { origin?: JoinRequestApiOrigin },
  ): Promise<JoinRequestAdmitted>;
  listOwn(input: OwnCall): Promise<JoinRequestMine>;
  file(
    input: OwnCall & { organizationId: string; origin?: JoinRequestApiOrigin },
  ): Promise<JoinRequestFiled>;
  withdraw(input: OwnCall & { joinRequestId: string }): Promise<void>;
  listPending(input: OrganizationCall): Promise<JoinRequestPending>;
  approve(input: Decision): Promise<void>;
  reject(input: Decision): Promise<void>;
  readJoining(input: OrganizationCall): Promise<JoinRequestJoining>;
  setJoining(
    input: OrganizationCall & {
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
      joinerRole?: JoinRequestJoining["joinerRole"];
      actorUserId: string;
    },
  ): Promise<JoinRequestJoiningChanged>;
  listAutomaticJoins(input: OrganizationCall): Promise<JoinRequestAutomaticJoins>;
  findAdmissions(
    input: OrganizationCall & { userIds: readonly string[] },
  ): Promise<IdentityDomainAdmission[]>;
}

/** What the join-request door reaches: identity's own door, as the process composed it. */
export interface JoinRequestDoorApi {
  joinRequestDoor(): JoinRequestDoor;
}

export const JoinRequestDoorApi = moduleApi<JoinRequestDoorApi>()("identity");

const NOT_A_MEMBER_YET = {
  reason:
    "the caller is asking about organizations they are not in yet, so there is no scope to hold a permission on; the handler answers only for the session's OWN verified addresses and reveals nothing else",
} as const;

const OWN_OFFER_ONLY = {
  reason:
    "the same own-verified-address answer `lookup` gives, minus the domains this caller has dismissed; no other person's organizations are reachable",
} as const;

const OWN_DISMISSAL_ONLY = {
  reason:
    "the caller silencing their own offer, on the domain their own session's verified address holds",
} as const;

const OWN_DOMAIN_ADMISSION_ONLY = {
  reason:
    "admits the caller to an organization that opted into admitting their own verified domain; the handler re-derives the match server-side and admits nothing else",
} as const;

const OWN_PENDING_REQUESTS = {
  reason: "the caller's own pending requests, keyed by their session id",
} as const;

const OFFERED_ORGANIZATION_ONLY = {
  reason:
    "asking to join is the one action a non-member takes on an organization; the handler proves the organization was OFFERED to this caller's verified domain and refuses anything else as if it did not exist",
  allow: { organizationId: "the organization the matcher offered" },
} as const;

const OWN_REQUEST_ONLY = {
  // No `allow` map: `joinRequestId` is not a scope id, and the handler refuses
  // a request that is not the caller's as if it did not exist.
  reason: "the requester withdrawing their own request, matched on the session's user id",
} as const;

export const joinRequestTrpcTransport: TrpcRouterDeclaration<
  JoinRequestDoorApi,
  typeof joinRequestTrpc
> = defineTrpcRouter(JoinRequestDoorApi, joinRequestTrpc)
  .procedure("lookup")
  .noPermission(NOT_A_MEMBER_YET)
  .handle(({ app, actor }) => app.joinRequestDoor().lookup({ userId: actor.id }))

  .procedure("offer")
  .noPermission(OWN_OFFER_ONLY)
  .handle(({ app, actor }) => app.joinRequestDoor().offer({ userId: actor.id }))

  .procedure("dismissOffer")
  .noPermission(OWN_DISMISSAL_ONLY)
  .handle(async ({ app, actor }) => {
    await app.joinRequestDoor().dismissOffer({ userId: actor.id });

    return { success: true as const };
  })

  .procedure("admitAutomatically")
  .noPermission(OWN_DOMAIN_ADMISSION_ONLY)
  .handle(({ app, input, actor }) =>
    app.joinRequestDoor().admitAutomatically({ userId: actor.id, origin: input.origin }),
  )

  .procedure("mine")
  .noPermission(OWN_PENDING_REQUESTS)
  .handle(({ app, actor }) => app.joinRequestDoor().listOwn({ userId: actor.id }))

  .procedure("request")
  .noPermission(OFFERED_ORGANIZATION_ONLY)
  .handle(({ app, input, actor }) =>
    app.joinRequestDoor().file({
      userId: actor.id,
      organizationId: input.organizationId,
      origin: input.origin,
    }),
  )

  .procedure("withdraw")
  .noPermission(OWN_REQUEST_ONLY)
  .handle(async ({ app, input, actor }) => {
    await app.joinRequestDoor().withdraw({ joinRequestId: input.joinRequestId, userId: actor.id });

    return { success: true as const };
  })

  /** What is waiting on this organization, for the members area. */
  .procedure("pending")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.joinRequestDoor().listPending({ organizationId: input.organizationId }),
  )

  /** Approve: no role on this input, ever. More goes through a formal invitation instead. */
  .procedure("approve")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await app.joinRequestDoor().approve({
      joinRequestId: input.joinRequestId,
      organizationId: input.organizationId,
      adminUserId: actor.id,
    });

    return { success: true as const };
  })

  /** Reject. No reason field: an admin who has to justify a refusal hesitates to make one. */
  .procedure("reject")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await app.joinRequestDoor().reject({
      joinRequestId: input.joinRequestId,
      organizationId: input.organizationId,
      adminUserId: actor.id,
    });

    return { success: true as const };
  })

  /** An organization's joining posture is not a stranger's business: gated like the write. */
  .procedure("joining")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.joinRequestDoor().readJoining({ organizationId: input.organizationId }),
  )

  .procedure("setJoining")
  .withPermission("organization:manage")
  .handle(({ app, input, actor }) =>
    app.joinRequestDoor().setJoining({
      organizationId: input.organizationId,
      domainJoin: input.domainJoin,
      domains: input.domains,
      joinerRole: input.joinerRole,
      actorUserId: actor.id,
    }),
  )

  /** Who walked in without anybody approving, lately: telling the admins after the fact. */
  .procedure("automaticJoins")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.joinRequestDoor().listAutomaticJoins({ organizationId: input.organizationId }),
  )

  /** Which of the listed members a matching domain admitted, for member provenance. */
  .procedure("getJoinAdmissions")
  .withPermission("organization:manage")
  .handle(({ app, input }) =>
    app.joinRequestDoor().findAdmissions({
      organizationId: input.organizationId,
      userIds: input.userIds,
    }),
  )
  .build();
