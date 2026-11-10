// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type { NurturingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import type { NurturingProjectUsageReadRepository } from "../repositories/nurturing-project-usage.repository.ts";
import {
  organizationUsageTraits,
  PROJECT_USAGE_WINDOW_MS,
  traceUsageTotalsOf,
} from "../rules/nurturing-project-usage.rules.ts";

type OrganizationUsageDependencies = Readonly<{
  projectUsage: NurturingProjectUsageReadRepository;
  /** Trace's own per-day read of its rollup: nurturing copies no trace. */
  traces: Pick<TraceApi, "findTraceUsageByDay">;
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
 * from nurturing's own rows, and its traces from trace's read when asked, and sends one group call
 * to the admin. Sends nothing for a project its owners place in no organization, or one with no
 * admin yet.
 */
export class NurturingOrganizationUsageService {
  static create(dependencies: OrganizationUsageDependencies): NurturingOrganizationUsageService {
    return new NurturingOrganizationUsageService(dependencies);
  }

  private constructor(private readonly dependencies: OrganizationUsageDependencies) {}

  /** An owner fact changed the project's rows: Postgres reads only, no trace read. */
  async usageChanged({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    await this.#sync({ projectId, readTraces: false });
  }

  /** The project traced: the trace traits too, read once per its organization's sync window. */
  async tracesChanged({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    await this.#sync({ projectId, readTraces: true });
  }

  async #sync({
    projectId,
    readTraces,
  }: Readonly<{ projectId: string; readTraces: boolean }>): Promise<void> {
    const { projectUsage, traces, projects, milestones, sendBatch, clock } = this.dependencies;
    if (projectId === "") return;
    const placement = await projects.getPlacement({ projectId });
    if (placement.outcome !== "known") return;
    const { organizationId } = placement;
    const [organization] = await milestones.findOrganization({ organizationId });
    const adminUserId = organization?.adminUserId;
    if (!adminUserId) return;
    const now = clock.nowMs();
    const projectIds = await projects.findProjectIds({ organizationId });
    const [usage, days, { organizationCreatedAt }] = await Promise.all([
      projectUsage.findForProjects({ projectIds }),
      readTraces
        ? traces.findTraceUsageByDay({
            organizationId,
            projectIds,
            sinceMs: now - PROJECT_USAGE_WINDOW_MS,
          })
        : null,
      projects.getOrganizationCreatedAt({ organizationId }),
    ]);
    const traits = organizationUsageTraits({
      projects: usage,
      traces: days === null ? null : traceUsageTotalsOf(days),
      now,
      organizationCreatedAt,
    });
    await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
  }
}
