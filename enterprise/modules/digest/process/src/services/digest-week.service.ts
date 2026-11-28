// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UsageStats } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";

import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../repositories/digest-week.repository.ts";
import { derivePlanUsage, type OrganizationWeek } from "../rules/digest-email.rules.ts";
import {
  BASELINE_WEEKS,
  emptyProjectWeek,
  oldestKeptWeek,
  type ProjectWeek,
  weeksBefore,
} from "../rules/digest-week.rules.ts";
import type { DigestTraceReadService } from "./digest-trace-read.service.ts";

const logger = createLogger("langwatch:digest");

type Deps = Readonly<{
  projectWeeks: Pick<DigestProjectWeekRepository, "findWeeks" | "deleteBefore">;
  userWeeks: Pick<DigestUserWeekRepository, "findWeeks" | "deleteBefore">;
  /** Trace numbers per project and week, read from analytics rather than folded. */
  traces: Pick<DigestTraceReadService, "getProjectWeek" | "getPreviousTraces">;
  /** `EntitlementApi.getUsage`, read for the two numbers the plan row needs. */
  entitlement: Readonly<{
    getUsage(input: {
      organizationId: string;
    }): Promise<Pick<UsageStats, "currentMonthMessagesCount" | "maxMonthlyUsageLimit">>;
  }>;
}>;

/**
 * The week folds: reads one organization's finished week (its folds, its trace numbers, and the
 * one plan read the send makes), and sweeps every organization's folds no send still reads.
 */
export class DigestWeekService {
  static create(deps: Deps): DigestWeekService {
    return new DigestWeekService(deps);
  }

  private constructor(private readonly deps: Deps) {}

  /**
   * The week of `projectIds` alone: the caller names the projects the recipient may see, so
   * analytics is never asked about one they may not.
   */
  async organizationWeek({
    organizationId,
    isoWeek,
    projectIds,
  }: {
    organizationId: string;
    isoWeek: string;
    projectIds: readonly string[];
  }): Promise<OrganizationWeek> {
    const before = weeksBefore({ isoWeek, count: BASELINE_WEEKS });
    const [lastWeek] = before;
    const visible = new Set(projectIds);
    const [folds, users, usage] = await Promise.all([
      this.deps.projectWeeks.findWeeks({ isoWeeks: [isoWeek, ...before], organizationId }),
      this.deps.userWeeks.findWeeks({ isoWeeks: [isoWeek], organizationId }),
      this.deps.entitlement.getUsage({ organizationId }),
    ]);
    const mine = folds.filter(({ projectId }) => visible.has(projectId));
    // A project whose read fails is left out of this email and logged; only when every one fails
    // does the send fail, for the outbox to retry, rather than mail a week with nothing in it.
    const reads = await Promise.allSettled(
      projectIds.map(async (projectId): Promise<ProjectWeek> => {
        const fold = mine.find((row) => row.projectId === projectId && row.isoWeek === isoWeek);
        const traces = await this.deps.traces.getProjectWeek({
          organizationId,
          projectId,
          isoWeek,
        });
        return { ...(fold ?? emptyProjectWeek()), projectId, organizationId, isoWeek, ...traces };
      }),
    );
    const projects = reads.flatMap((read, index) => {
      if (read.status === "fulfilled") return [read.value];
      logger.warn(
        { error: read.reason, organizationId, projectId: projectIds[index], isoWeek },
        "the digest left a project out: its week could not be read",
      );
      return [];
    });
    const firstFailure = reads.find((read) => read.status === "rejected");
    if (projects.length === 0 && firstFailure) throw firstFailure.reason;
    // Every project's last week: a busy one shows its change, an empty one may have gone quiet. A
    // read that fails leaves the project without one: no change line, and never called quiet.
    const previousTraces = new Map<string, number>();
    await Promise.all(
      projects.map(async ({ projectId }) => {
        if (!lastWeek) return;
        try {
          previousTraces.set(
            projectId,
            await this.deps.traces.getPreviousTraces({
              organizationId,
              projectId,
              isoWeek: lastWeek,
            }),
          );
        } catch (error) {
          logger.warn({ error, organizationId, projectId }, "the digest could not read last week");
        }
      }),
    );
    return {
      organizationId,
      isoWeek,
      planUsage: derivePlanUsage(usage) ?? null,
      projects,
      history: mine.filter((fold) => fold.isoWeek !== isoWeek),
      previousTraces,
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
