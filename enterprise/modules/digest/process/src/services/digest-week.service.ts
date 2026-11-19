// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { UsageStats } from "@langwatch/entitlement-contract";

import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../repositories/digest-week.repository.ts";
import { type OrganizationWeek, planUsageOf } from "../rules/digest-email.rules.ts";
import { BASELINE_WEEKS, weeksBefore } from "../rules/digest-week.rules.ts";

type Deps = Readonly<{
  projectWeeks: Pick<DigestProjectWeekRepository, "listWeeks">;
  userWeeks: Pick<DigestUserWeekRepository, "listWeeks">;
  /** `EntitlementApi.getUsage`, read for the two numbers the plan-pressure pick needs. */
  entitlement: Readonly<{
    getUsage(input: {
      organizationId: string;
    }): Promise<Pick<UsageStats, "currentMonthMessagesCount" | "maxMonthlyUsageLimit">>;
  }>;
}>;

/** Reads one organization's finished week: its folds, and the one plan read the send makes. */
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
      this.deps.projectWeeks.listWeeks({ isoWeeks: [isoWeek, ...before], organizationId }),
      this.deps.userWeeks.listWeeks({ isoWeeks: [isoWeek], organizationId }),
      this.deps.entitlement.getUsage({ organizationId }),
    ]);
    return {
      organizationId,
      isoWeek,
      planUsage: planUsageOf(usage),
      projects: folds.filter((fold) => fold.isoWeek === isoWeek),
      history: folds.filter((fold) => fold.isoWeek !== isoWeek),
      users: new Map(users.map((user) => [user.userId, user])),
    };
  }
}
