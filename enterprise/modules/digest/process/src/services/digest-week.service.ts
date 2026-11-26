// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UsageStats } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../repositories/digest-week.repository.ts";
import { derivePlanUsage, type OrganizationWeek } from "../rules/digest-email.rules.ts";
import {
  BASELINE_WEEKS,
  emptyProjectWeek,
  oldestKeptWeek,
  type ProjectWeekState,
  weeksBefore,
} from "../rules/digest-week.rules.ts";
import type { DigestTraceReadService } from "./digest-trace-read.service.ts";

type Deps = Readonly<{
  projectWeeks: Pick<DigestProjectWeekRepository, "findWeeks" | "deleteBefore">;
  userWeeks: Pick<DigestUserWeekRepository, "findWeeks" | "deleteBefore">;
  /** The organization's projects: the ones whose traces are read for its week. */
  projects: Pick<ProjectApi, "listIdsByOrganization">;
  /** Trace numbers per project and week, read from analytics rather than folded. */
  traces: Pick<DigestTraceReadService, "projectWeek">;
  /** `EntitlementApi.getUsage`, read for the two numbers the plan-pressure pick needs. */
  entitlement: Readonly<{
    getUsage(input: {
      organizationId: string;
    }): Promise<Pick<UsageStats, "currentMonthMessagesCount" | "maxMonthlyUsageLimit">>;
  }>;
}>;

/**
 * The week folds: reads one organization's finished week (its folds, and the one plan read the
 * send makes), and sweeps every organization's folds no send still reads.
 */
export class DigestWeekService {
  static create(deps: Deps): DigestWeekService {
    return new DigestWeekService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  async organizationWeek({
    organizationId,
    isoWeek,
  }: {
    organizationId: string;
    isoWeek: string;
  }): Promise<OrganizationWeek> {
    const before = weeksBefore({ isoWeek, count: BASELINE_WEEKS });
    const [folds, users, usage, projectIds] = await Promise.all([
      this.deps.projectWeeks.findWeeks({ isoWeeks: [isoWeek, ...before], organizationId }),
      this.deps.userWeeks.findWeeks({ isoWeeks: [isoWeek], organizationId }),
      this.deps.entitlement.getUsage({ organizationId }),
      this.deps.projects.listIdsByOrganization({ organizationId }),
    ]);
    // Trace numbers are read for the week sent and the one before it (its change is shown); the
    // older baseline weeks only ever read scenario outcomes, which stay folded.
    const [previous] = before;
    const traceWeeks = [isoWeek, ...(previous ? [previous] : [])];
    const withTraces = async (week: string) =>
      Promise.all(
        projectIds.map(async (projectId): Promise<ProjectWeekState> => {
          const fold = folds.find((row) => row.projectId === projectId && row.isoWeek === week);
          const traces = await this.deps.traces.projectWeek({ projectId, isoWeek: week });
          return {
            ...(fold ?? emptyProjectWeek()),
            projectId,
            organizationId,
            isoWeek: week,
            ...traces,
          };
        }),
      );
    const [current, ...earlier] = await Promise.all(traceWeeks.map(withTraces));
    const read = new Set(traceWeeks);
    return {
      organizationId,
      isoWeek,
      planUsage: derivePlanUsage(usage) ?? null,
      projects: current ?? [],
      history: [
        ...earlier.flat(),
        ...folds.filter((fold) => fold.isoWeek !== isoWeek && !read.has(fold.isoWeek)),
      ],
      users: new Map(users.map((user) => [user.userId, user])),
    };
  }

  /**
   * The hourly wake's retention sweep, across organizations: drops the folds older than the week
   * a send at `at` covers and the baseline weeks it reads.
   */
  async sweep({ at }: { at: number }): Promise<void> {
    const oldest = oldestKeptWeek(at);
    await Promise.all([
      this.deps.projectWeeks.deleteBefore({ isoWeek: oldest }),
      this.deps.userWeeks.deleteBefore({ isoWeek: oldest }),
    ]);
  }
}
