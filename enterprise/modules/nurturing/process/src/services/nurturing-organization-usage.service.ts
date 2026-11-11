// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

import type { NurturingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
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
  /** Placement, the organization's projects and its creation, read through the owners' shares. */
  projects: Pick<
    NurturingProjectDirectoryRepository,
    "getPlacement" | "findProjectIds" | "getOrganizationCreatedAt"
  >;
  milestones: Pick<NurturingMilestonesRepository, "findOrganization">;
  /** Rejects when Customer.io did not take the call, so the subscriber's job retries. */
  sendBatch: (calls: CioBatchCall[]) => Promise<void>;
  clock: Readonly<{ nowMs: () => number }>;
}>;

/**
 * Turns a project's changed usage into its organization's traits: sums the organization's projects
 * from nurturing's own rows, and sends one group call to the admin. It reads no other module's
 * data: trace counts start at nurturing's first counted trace. Sends nothing for a project its
 * owners place in no organization, or one with no admin yet.
 */
export class NurturingOrganizationUsageService {
  static create(dependencies: OrganizationUsageDependencies): NurturingOrganizationUsageService {
    return new NurturingOrganizationUsageService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationUsageDependencies) {}

  /** The project's usage or traces changed: its organization's traits go to Customer.io. */
  async usageChanged({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    const { projectUsage, traceDays, projects, milestones, sendBatch, clock } = this.dependencies;
    if (projectId === "") return;
    const placement = await projects.getPlacement({ projectId });
    if (placement.outcome !== "known") return;
    const { organizationId } = placement;
    const [organization] = await milestones.findOrganization({ organizationId });
    const adminUserId = organization?.adminUserId;
    if (!adminUserId) return;
    const now = clock.nowMs();
    const windowStartDay = windowStartDayOf(now);
    const projectIds = await projects.findProjectIds({ organizationId });
    await traceDays.pruneBefore({ projectIds, beforeDay: windowStartDay });
    const [usage, folded, { organizationCreatedAt }] = await Promise.all([
      projectUsage.findForProjects({ projectIds }),
      traceDays.findForProjects({ projectIds, afterDay: windowStartDay }),
      projects.getOrganizationCreatedAt({ organizationId }),
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
