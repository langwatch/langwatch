import type { IdentityApi } from "@langwatch/identity-contract";
import type { JoinRequestAdmitted, JoinRequestJoining } from "@langwatch/organization-contract";

/** One waiting join request, as the ledger folds it. */
export type OrganizationJoinRequestState = Readonly<{
  joinRequestId: string;
  userId: string;
  organizationId: string;
  domain: string;
  createdAtMs: number;
  expiresAtMs: number | null;
  resolvedAtMs: number | null;
}>;

/**
 * Asking to join, and answering. The identity feature owns the decision
 * `lookup` answers with, so it travels through here unread.
 */
export interface OrganizationJoinRequests {
  lookup(input: Readonly<{ userId: string; verifiedEmail: string | null }>): Promise<unknown>;
  /** The post-login offer: the lookup, minus the domains this person dismissed. */
  offerForSignedInUser(
    input: Readonly<{ userId: string; verifiedEmail: string | null }>,
  ): Promise<unknown>;
  dismissOffer(input: Readonly<{ userId: string; verifiedEmail: string | null }>): Promise<void>;
  joinAutomaticallyIfAdmitted(
    input: Readonly<{ userId: string; verifiedEmail: string | null }>,
  ): Promise<JoinRequestAdmitted>;
  automaticJoinsForOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly OrganizationJoinRequestState[]>;
  pendingForUser(
    input: Readonly<{ userId: string }>,
  ): Promise<readonly OrganizationJoinRequestState[]>;
  pendingForOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<readonly OrganizationJoinRequestState[]>;
  request(
    input: Readonly<{ userId: string; verifiedEmail: string | null; organizationId: string }>,
  ): Promise<Readonly<{ joinRequestId: string; state: "PENDING" | "APPROVED" }>>;
  withdraw(input: Readonly<{ joinRequestId: string; userId: string }>): Promise<void>;
  approve(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void>;
  reject(
    input: Readonly<{ joinRequestId: string; organizationId: string; adminUserId: string }>,
  ): Promise<void>;
  readJoining(input: Readonly<{ organizationId: string }>): Promise<JoinRequestJoining>;
  setJoining(
    input: Readonly<{
      organizationId: string;
      domainJoin: JoinRequestJoining["domainJoin"];
      domains: readonly string[];
      joinerRole?: JoinRequestJoining["joinerRole"];
      actorUserId: string;
    }>,
  ): Promise<
    Readonly<{
      previous: JoinRequestJoining["domainJoin"];
      next: JoinRequestJoining["domainJoin"];
      previousDomains: readonly string[];
      nextDomains: readonly string[];
      previousJoinerRole: JoinRequestJoining["joinerRole"];
      nextJoinerRole: JoinRequestJoining["joinerRole"];
    }>
  >;
  /** A formal invitation ANSWERS the same person's open request. */
  resolveByInvitation(
    input: Readonly<{ userId: string; organizationId: string; inviteId: string }>,
  ): Promise<void>;
  /** Accepting an invitation WITHDRAWS the same person's open request. */
  withdrawOnInvitationAccepted(
    input: Readonly<{ userId: string; organizationId: string }>,
  ): Promise<void>;
}

/**
 * Identity's join-request ledger, asked per call: a peer is not callable while
 * the process is still constructing, and this door is built during it.
 */
export class OrganizationJoinRequestsService {
  private constructor() {}

  static create(identity: Pick<IdentityApi, "joinRequests">): OrganizationJoinRequests {
    const ledger = () => identity.joinRequests();
    return {
      lookup: (input) => ledger().lookup(input),
      offerForSignedInUser: (input) => ledger().offerForSignedInUser(input),
      dismissOffer: (input) => ledger().dismissOffer(input),
      joinAutomaticallyIfAdmitted: (input) => ledger().joinAutomaticallyIfAdmitted(input),
      automaticJoinsForOrganization: (input) => ledger().automaticJoinsForOrganization(input),
      pendingForUser: (input) => ledger().pendingForUser(input),
      pendingForOrganization: (input) => ledger().pendingForOrganization(input),
      request: (input) => ledger().request(input),
      withdraw: (input) => ledger().withdraw(input),
      approve: (input) => ledger().approve(input),
      reject: (input) => ledger().reject(input),
      readJoining: (input) => ledger().readJoining(input),
      setJoining: (input) => ledger().setJoining(input),
      resolveByInvitation: (input) => ledger().resolveByInvitation(input),
      withdrawOnInvitationAccepted: (input) => ledger().withdrawOnInvitationAccepted(input),
    };
  }
}
