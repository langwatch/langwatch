// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UsageStats } from "@langwatch/entitlement-contract";

import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../repositories/digest-week.repository.ts";
import { derivePlanUsage, type OrganizationWeek } from "../rules/digest-email.rules.ts";
import { BASELINE_WEEKS, oldestKeptWeek, weeksBefore } from "../rules/digest-week.rules.ts";

type Deps = Readonly<{
  projectWeeks: Pick<DigestProjectWeekRepository, "findWeeks" | "deleteBefore">;
  userWeeks: Pick<DigestUserWeekRepository, "findWeeks" | "deleteBefore">;
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
    const [folds, users, usage] = await Promise.all([
      this.deps.projectWeeks.findWeeks({ isoWeeks: [isoWeek, ...before], organizationId }),
      this.deps.userWeeks.findWeeks({ isoWeeks: [isoWeek], organizationId }),
      this.deps.entitlement.getUsage({ organizationId }),
    ]);
    return {
      organizationId,
      isoWeek,
      planUsage: derivePlanUsage(usage) ?? null,
      projects: folds.filter((fold) => fold.isoWeek === isoWeek),
      history: folds.filter((fold) => fold.isoWeek !== isoWeek),
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
