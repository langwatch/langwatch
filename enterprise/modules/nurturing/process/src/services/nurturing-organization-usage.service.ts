// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";
import type { NurturingProjectUsageReadRepository } from "../repositories/nurturing-project-usage.repository.ts";
import type { NurturingTraceDayReadRepository } from "../repositories/nurturing-trace-day.repository.ts";
import {
  organizationUsageTraits,
  windowStartDayOf,
} from "../rules/nurturing-project-usage.rules.ts";
import { traceCountsOf } from "../rules/nurturing-trace-day.rules.ts";

type OrganizationUsageDependencies = Readonly<{
  projectUsage: NurturingProjectUsageReadRepository;
  traceDays: NurturingTraceDayReadRepository;
  /** Nurturing's own copy of each project's organization, from project's creation facts. */
  placements: Pick<NurturingProjectPlacementRepository, "getPlacement" | "findProjectIds">;
  /** Nurturing's own copy of each organization's creation, from organization's facts. */
  organizationsCreated: Pick<NurturingOrganizationCreatedRepository, "findOrganizationCreatedAt">;
  milestones: Pick<NurturingMilestonesRepository, "findOrganization">;
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  clock: Readonly<{ nowMs: () => number }>;
}>;

/**
 * Turns a project's changed usage into its organization's traits: sums the organization's projects
 * from nurturing's own rows, and sends one group call to the admin. It reads no other module's
 * data, not even placement: trace counts start at nurturing's first counted trace. Sends nothing
 * for a project nurturing never saw created (one made before it kept the copy), or one with no
 * admin yet.
 */
export class NurturingOrganizationUsageService {
  static create(dependencies: OrganizationUsageDependencies): NurturingOrganizationUsageService {
    return new NurturingOrganizationUsageService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationUsageDependencies) {}

  /** The project's usage or traces changed: its organization's traits go to Customer.io. */
  async usageChanged({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    const {
      projectUsage,
      traceDays,
      placements,
      organizationsCreated,
      milestones,
      sendBatch,
      clock,
    } = this.dependencies;
    if (projectId === "") return;
    const now = clock.nowMs();
    const windowStartDay = windowStartDayOf(now);
    // Trace days are written for every project, placed or not, so its own old rows go first.
    await traceDays.pruneBefore({ projectIds: [projectId], beforeDay: windowStartDay });
    const placement = await placements.getPlacement({ projectId });
    if (placement.outcome !== "known") return;
    const { organizationId } = placement;
    const [organization] = await milestones.findOrganization({ organizationId });
    const adminUserId = organization?.adminUserId;
    if (!adminUserId) return;
    const projectIds = await placements.findProjectIds({ organizationId });
    await traceDays.pruneBefore({ projectIds, beforeDay: windowStartDay });
    const [usage, folded, { organizationCreatedAt }] = await Promise.all([
      projectUsage.findForProjects({ projectIds }),
      traceDays.findForProjects({ projectIds, afterDay: windowStartDay }),
      organizationsCreated.findOrganizationCreatedAt({ organizationId }),
    ]);
    const traces = traceCountsOf({ days: folded, windowStartDay });
    const traits = organizationUsageTraits({
      projects: usage,
      traces,
      now,
      organizationCreatedAt,
    });
    await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
  }
}
