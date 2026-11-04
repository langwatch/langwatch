// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { OrganizationApi } from "@langwatch/organization-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingTraceMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import { pickOrganizationDebounce } from "../rules/nurturing-delivery-debounce.rules.ts";
import {
  isTraceFact,
  type KnownTraces,
  type MemberFactSignal,
} from "../rules/nurturing-member-facts.rules.ts";

type MemberFactsDependencies = Readonly<{
  claims: NurturingClaimRepository;
  milestones: NurturingTraceMilestonesRepository;
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
   * Every active member, read only after the organization's own window is won, so one busy
   * organization costs one read and one batch per window. Empty when the window already sent.
   * A project its owners do not place tells only the admin the signal names, as before.
   */
  async recipientsOf(signal: MemberFactSignal): Promise<readonly string[]> {
    const placement = await this.dependencies.projects.getPlacement({
      projectId: signal.projectId,
    });
    if (placement.outcome === "unknown") return [signal.userId];
    const { organizationId } = placement;

    // Before the window's claim: a trace the window drops is still the one a joiner must be told.
    if (isTraceFact(signal)) {
      await this.dependencies.milestones.recordLastTrace({
        organizationId,
        occurredAt: signal.occurredAt,
      });
    }
    const debounce = pickOrganizationDebounce({ signal, organizationId });
    if (debounce && !(await this.dependencies.claims.claim(debounce.claimKey, debounce.seconds))) {
      return [];
    }
    const members = await this.dependencies.organizations.getAllMembers({ organizationId });
    return members.map(({ id }) => id);
  }

  /** Across every organization of the person: their profile is one, whichever org it is about. */
  async tracesOfPerson({
    userId,
    organizationId,
  }: Readonly<{ userId: string; organizationId: string }>): Promise<KnownTraces> {
    const memberOf = await this.dependencies.organizations.organizationIdsForMember({ userId });
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
