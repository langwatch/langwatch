// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type {
  NurturingMilestonesRepository,
  NurturingTraceMilestonesRepository,
} from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import { pickOrganizationDebounce } from "../rules/nurturing-delivery-debounce.rules.ts";
import type { KnownTraces, MemberFactSignal } from "../rules/nurturing-member-facts.rules.ts";
import type { NurturingOrganizationAdmin } from "../rules/nurturing-subscription-sync-service.rules.ts";
import { NurturingClaimReleaseService } from "./nurturing-claim-release.service.ts";

type MemberFactsDependencies = Readonly<{
  claims: NurturingClaimRepository;
  milestones: NurturingTraceMilestonesRepository &
    Pick<NurturingMilestonesRepository, "findOrganization">;
  projects: NurturingProjectDirectoryRepository;
  organizations: OrganizationApi;
}>;

/** Who hears an organization's fact, and what a person joining or signing up is told of traces. */
export class NurturingMemberFactsService {
  static create(dependencies: MemberFactsDependencies): NurturingMemberFactsService {
    return new NurturingMemberFactsService(dependencies);
  }

  private constructor(private readonly dependencies: MemberFactsDependencies) {}

  /**
   * Spends the organization's window, then returns every active member (one read per window).
   * Empty when the window already sent; a failed read gives it back. A project its owners do not
   * place tells only the admin the signal names.
   */
  async recordFactAndClaimRecipients(signal: MemberFactSignal): Promise<readonly string[]> {
    const placement = await this.dependencies.projects.getPlacement({
      projectId: signal.projectId,
    });
    if (placement.outcome === "unknown") return [signal.userId];
    const { organizationId } = placement;

    const debounce = pickOrganizationDebounce({ signal, organizationId });
    if (debounce && !(await this.dependencies.claims.claim(debounce.claimKey, debounce.seconds))) {
      return [];
    }
    try {
      const members = await this.dependencies.organizations.getAllMembers({ organizationId });
      return members.map(({ id }) => id);
    } catch (error) {
      return NurturingClaimReleaseService.create(this.dependencies.claims).rethrowAfterReleasing({
        error,
        keys: debounce ? [debounce.claimKey] : [],
      });
    }
  }

  /** The admin nurturing's own copy names for the organization, or none when it knows none. */
  async adminOf({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationAdmin> {
    const [organization] = await this.dependencies.milestones.findOrganization({ organizationId });
    const userId = organization?.adminUserId;
    return userId ? { kind: "admin", userId } : { kind: "none" };
  }

  /** Across every organization of the person: their profile is one, whichever org it is about. */
  async tracesOfPerson({
    userId,
    organizationId,
  }: Readonly<{ userId: string; organizationId: string }>): Promise<KnownTraces> {
    // Disabled memberships count: their traces already reached the profile, which must not regress.
    const memberOf = await this.dependencies.organizations.organizationIdsForMember({
      userId,
      activeOnly: false,
    });
    const known = await Promise.all(
      [...new Set([organizationId, ...memberOf])].map((id) => this.tracesOfOrganization(id)),
    );
    const times = known.flatMap(({ lastTraceAt }) => (lastTraceAt === null ? [] : [lastTraceAt]));
    return {
      hasTraces: known.some(({ hasTraces }) => hasTraces),
      lastTraceAt: times.length > 0 ? Math.max(...times) : null,
    };
  }

  /** Project's first-message flag also covers traces from before nurturing stored a time. */
  private async tracesOfOrganization(organizationId: string): Promise<KnownTraces> {
    const [lastTraceAt, hasTraced] = await Promise.all([
      this.dependencies.milestones.findLastTraceAt({ organizationId }),
      this.dependencies.projects.hasTracedProject({ organizationId }),
    ]);
    return { hasTraces: hasTraced || lastTraceAt !== null, lastTraceAt };
  }
}
