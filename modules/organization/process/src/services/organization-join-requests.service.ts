import type { IdentityApi } from "@langwatch/identity-contract";

/** What the Directory's join-request badge counts; identity serves the door itself. */
export interface OrganizationJoinRequests {
  pendingForOrganization(input: Readonly<{ organizationId: string }>): Promise<readonly unknown[]>;
}

/**
 * Identity's join-request ledger, asked per call: a peer is not callable while
 * the process is still constructing, and this reader is built during it.
 */
export class OrganizationJoinRequestsService {
  private constructor() {}

  static create(identity: Pick<IdentityApi, "joinRequests">): OrganizationJoinRequests {
    return {
      pendingForOrganization: (input) => identity.joinRequests().pendingForOrganization(input),
    };
  }
}
