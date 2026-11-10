// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingCodingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import type { NurturingProjectUsageReadRepository } from "../repositories/nurturing-project-usage.repository.ts";
import {
  type NurturingProjectUsageState,
  organizationUsageTraits,
} from "../rules/nurturing-project-usage.rules.ts";

type OrganizationUsageDependencies = Readonly<{
  projectUsage: NurturingProjectUsageReadRepository;
  /** Placement and the organization's creation, read through the owners' shares (R40). */
  projects: Pick<NurturingProjectDirectoryRepository, "getPlacement" | "getOrganizationCreatedAt">;
  milestones: Pick<NurturingCodingMilestonesRepository, "findOrganization">;
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  clock: Readonly<{ nowMs: () => number }>;
}>;

/**
 * Turns a project's changed usage into its organization's traits: places the project, sums the
 * organization's projects from nurturing's own rows and sends one group call to the admin.
 */
export class NurturingOrganizationUsageService {
  static create(dependencies: OrganizationUsageDependencies): NurturingOrganizationUsageService {
    return new NurturingOrganizationUsageService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationUsageDependencies) {}

  /** Sends nothing for a project its owners place in no organization, or one with no admin yet. */
  async usageChanged(state: NurturingProjectUsageState): Promise<void> {
    const { projectUsage, projects, milestones, sendBatch, clock } = this.dependencies;
    if (state.projectId === "") return;
    const placement = await projects.getPlacement({ projectId: state.projectId });
    if (placement.outcome !== "known") return;
    const { organizationId } = placement;
    await projectUsage.placeProject({ projectId: state.projectId, organizationId });
    const [organization] = await milestones.findOrganization({ organizationId });
    const adminUserId = organization?.adminUserId;
    if (!adminUserId) return;
    const [usage, { organizationCreatedAt }] = await Promise.all([
      projectUsage.findForOrganization({ organizationId }),
      projects.getOrganizationCreatedAt({ organizationId }),
    ]);
    const traits = organizationUsageTraits({
      projects: usage,
      now: clock.nowMs(),
      organizationCreatedAt,
    });
    await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
  }
}
