// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type { NurturingClaimRepository } from "../repositories/nurturing-claim.repository.ts";
import type { NurturingMilestonesRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import type { NurturingProjectUsageReadRepository } from "../repositories/nurturing-project-usage.repository.ts";
import type { NurturingTraceDayReadRepository } from "../repositories/nurturing-trace-day.repository.ts";
import {
  organizationUsageTraits,
  PROJECT_USAGE_WINDOW_MS,
  totalCostOf,
  windowStartDayOf,
} from "../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";
import {
  type NurturingTraceDayState,
  seedCutoffOf,
  seedDaysOf,
  traceCountsOf,
} from "../rules/nurturing-trace-day.rules.ts";

/** Long enough to outlive its UTC day: the key names the day, so a new day claims afresh. */
const COST_READ_CLAIM_SECONDS = 26 * 60 * 60;

type OrganizationUsageDependencies = Readonly<{
  projectUsage: NurturingProjectUsageReadRepository;
  traceDays: NurturingTraceDayReadRepository;
  /** Trace's read of its rollup: the daily cost (a span has no price), and each project's seed. */
  traces: Pick<TraceApi, "findTraceUsageByDay">;
  claims: NurturingClaimRepository;
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
 * from nurturing's own rows, reads trace's cost at most once per organization and UTC day, and
 * sends one group call to the admin. Sends nothing for a project its owners place in no
 * organization, or one with no admin yet.
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
    const seeds = await this.#seededDays({ organizationId, projectIds, folded, now });
    const traces = traceCountsOf({ days: [...folded, ...seeds], windowStartDay });
    const cost = await this.#claimDailyCost({ organizationId, projectIds, now, traces });
    const traits = organizationUsageTraits({
      projects: usage,
      traces,
      totalCost: cost.totalCost,
      now,
      organizationCreatedAt,
    });
    try {
      await sendBatch([{ type: "group", userId: adminUserId, groupId: organizationId, traits }]);
    } catch (error) {
      if (cost.claimKey) await this.dependencies.claims.release(cost.claimKey);
      throw error;
    }
  }

  /**
   * The projects' seed days, seeding each project not seeded yet, once: trace's rollup of the
   * window up to the minute of the fold's first trace, so the seed and the fold never share one.
   */
  async #seededDays({
    organizationId,
    projectIds,
    folded,
    now,
  }: Readonly<{
    organizationId: string;
    projectIds: readonly string[];
    folded: readonly NurturingTraceDayState[];
    now: number;
  }>): Promise<NurturingTraceDayState[]> {
    const { traceDays, traces } = this.dependencies;
    const afterDay = windowStartDayOf(now);
    const known = await traceDays.findSeeds({ projectIds, afterDay });
    const unseeded = projectIds.filter((id) => !known.seededProjectIds.includes(id));
    const seeded = await Promise.all(
      unseeded.map(async (projectId) => {
        const untilMs = seedCutoffOf({
          folded: folded.filter((day) => day.projectId === projectId),
          now,
        });
        const days = seedDaysOf({
          projectId,
          days: await traces.findTraceUsageByDay({
            organizationId,
            projectIds: [projectId],
            sinceMs: now - PROJECT_USAGE_WINDOW_MS,
            untilMs,
          }),
        });
        await traceDays.recordSeed({ projectId, seededAt: now, days });
        return days;
      }),
    );
    return [...known.days, ...seeded.flat()];
  }

  /** The window's cost, read once per organization and UTC day; no trace, no read, no cost. */
  async #claimDailyCost({
    organizationId,
    projectIds,
    now,
    traces,
  }: Readonly<{
    organizationId: string;
    projectIds: readonly string[];
    now: number;
    traces: Readonly<{ traceCount: number }>;
  }>): Promise<Readonly<{ totalCost: number | null; claimKey: string | null }>> {
    if (traces.traceCount === 0) return { totalCost: 0, claimKey: null };
    const { claims, traces: traceApi } = this.dependencies;
    const claimKey = `nurturing:trace-cost:${organizationId}:${utcDayOf(now)}`;
    if (!(await claims.claim(claimKey, COST_READ_CLAIM_SECONDS))) {
      return { totalCost: null, claimKey: null };
    }
    try {
      const days = await traceApi.findTraceUsageByDay({
        organizationId,
        projectIds,
        sinceMs: now - PROJECT_USAGE_WINDOW_MS,
      });
      return { totalCost: totalCostOf(days), claimKey };
    } catch (error) {
      await claims.release(claimKey);
      throw error;
    }
  }
}
