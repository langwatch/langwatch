import type { OrganizationApi } from "@langwatch/organization-contract";

import type { SsoRegistrantReadRepository } from "../repositories/sso-registrant.repository.ts";
import type { SsoRegistrantReads } from "../rules/sso-assertion-contract.rules.ts";

export interface SsoRegistrantReadsDeps {
  registrants: SsoRegistrantReadRepository;
  organizations: OrganizationApi;
}

/**
 * Who an asserted address and a connection subject belong to: identity's own
 * rows answer the address, the organization peer answers the membership. Both
 * halves are load-bearing, so neither is assumed when the other says yes.
 */
export class SsoRegistrantReadsService implements SsoRegistrantReads {
  static create(deps: SsoRegistrantReadsDeps): SsoRegistrantReadsService {
    return new SsoRegistrantReadsService(deps);
  }

  private constructor(private readonly deps: SsoRegistrantReadsDeps) {}

  /** Membership first: it is the cheaper half and the one that fails for a
   *  registrant who has since left, which is the case this guard exists for. */
  async findRegistrantAtAddress({
    organizationId,
    userId,
    email,
  }: {
    organizationId: string;
    userId: string;
    email: string;
  }): Promise<boolean> {
    if (!(await this.deps.organizations.isMember({ organizationId, userId }))) return false;
    return this.deps.registrants.holdsAddress({ userId, email });
  }

  async findBoundMemberIdentity({
    organizationId,
    connectionId,
    accountId,
    email,
  }: {
    organizationId: string;
    connectionId: string;
    accountId: string;
    email: string;
  }): Promise<boolean> {
    const holders = await this.deps.registrants.findAccountHolderIds({ connectionId, accountId });
    for (const userId of holders) {
      if (await this.findRegistrantAtAddress({ organizationId, userId, email })) return true;
    }
    return false;
  }
}
