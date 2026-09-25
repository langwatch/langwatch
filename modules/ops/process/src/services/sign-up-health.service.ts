import type { IdentityLookupApi } from "@langwatch/identity-contract";
import type { OpsSignUpHealthInput, SignUpHealth } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";

import {
  ORPHANED_ORGANIZATION_WINDOW_MS,
  resolveSignUpHealth,
} from "../rules/sign-up-health.rules.ts";

/**
 * How many organizations people made that they did not mean to make (D12), derived
 * from stored rows so any window reads, including those before the flag existed.
 */
export class SignUpHealthService {
  static create(peers: {
    organizations: Pick<OrganizationApi, "findFoundedBetween">;
    identity: Pick<IdentityLookupApi, "findVerifiedDomainsByUserIds">;
  }): SignUpHealthService {
    return new SignUpHealthService(peers.organizations, peers.identity);
  }

  private constructor(
    private readonly organizations: Pick<OrganizationApi, "findFoundedBetween">,
    private readonly identity: Pick<IdentityLookupApi, "findVerifiedDomainsByUserIds">,
  ) {}

  /** Founders are followed thirty days past the window: a founding on its last day is
   *  orphaned only by what comes after it. */
  async getSignUpHealth({ fromMs, toMs }: OpsSignUpHealthInput): Promise<SignUpHealth> {
    const founded = await this.organizations.findFoundedBetween({
      fromMs,
      toMs,
      followUntilMs: toMs + ORPHANED_ORGANIZATION_WINDOW_MS,
    });
    const founders = [...new Set(founded.map((organization) => organization.founderUserId))];
    const proved =
      founders.length === 0
        ? []
        : await this.identity.findVerifiedDomainsByUserIds({ userIds: founders });

    return resolveSignUpHealth({
      founded,
      provedFounders: new Set(proved.map((domain) => domain.userId)),
      fromMs,
      toMs,
    });
  }
}
