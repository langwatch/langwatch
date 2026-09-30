// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { DigestUpdate } from "@langwatch/enterprise-digest-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";

import type { DigestAudienceRepository } from "../repositories/digest-audience.repository.ts";
import type {
  DigestProjectWeekRepository,
  DigestUserWeekRepository,
} from "../repositories/digest-week.repository.ts";
import {
  type ScenarioTrend,
  scenarioTrendOf,
  type TemplateInput,
} from "../rules/digest-template.rules.ts";
import {
  type ProjectWeekState,
  userWeekTotals,
  type UserWeekState,
  weeksBefore,
} from "../rules/digest-week.rules.ts";

/** One organization's finished week: its folds, its plan usage (one read), the week's card. */
export type OrganizationWeek = Readonly<{
  organizationId: string;
  isoWeek: string;
  used: number;
  limit: number;
  members: number;
  planUsagePercent: number;
  projects: readonly ProjectWeekState[];
  /** Each project's week before, for the traces change. */
  lastWeek: readonly ProjectWeekState[];
  busiest: ProjectWeekState | undefined;
  trend: Readonly<{ project: ProjectWeekState; trend: ScenarioTrend }> | undefined;
  users: ReadonlyMap<string, UserWeekState>;
  update: DigestUpdate | undefined;
}>;

const BASELINE_WEEKS = 4;

/** Reads the folds and the one plan read a week's emails are picked and written from. */
export class DigestWeekService {
  static create(deps: {
    projectWeeks: DigestProjectWeekRepository;
    userWeeks: DigestUserWeekRepository;
    audience: DigestAudienceRepository;
    entitlement: Pick<EntitlementApi, "getUsage">;
  }): DigestWeekService {
    return new DigestWeekService(deps);
  }

  private constructor(
    private readonly deps: {
      projectWeeks: DigestProjectWeekRepository;
      userWeeks: DigestUserWeekRepository;
      audience: DigestAudienceRepository;
      entitlement: Pick<EntitlementApi, "getUsage">;
    },
  ) {}

  async organizationWeek({
    organizationId,
    isoWeek,
  }: {
    organizationId: string;
    isoWeek: string;
  }): Promise<OrganizationWeek> {
    const before = weeksBefore({ isoWeek, count: BASELINE_WEEKS });
    const [folds, users, usage, updates] = await Promise.all([
      this.deps.projectWeeks.listWeeks({ isoWeeks: [isoWeek, ...before], organizationId }),
      this.deps.userWeeks.listWeeks({ isoWeeks: [isoWeek], organizationId }),
      this.deps.entitlement.getUsage({ organizationId }),
      this.deps.audience.listUpdates(),
    ]);
    const projects = folds.filter((fold) => fold.isoWeek === isoWeek);
    const used = usage.currentMonthMessagesCount ?? 0;
    const limit = usage.maxMonthlyUsageLimit;
    return {
      organizationId,
      isoWeek,
      used,
      limit,
      members: usage.membersCount,
      planUsagePercent: limit > 0 ? (used / limit) * 100 : 0,
      projects,
      lastWeek: folds.filter((fold) => fold.isoWeek === before[0]),
      busiest: projects.toSorted((left, right) => right.traces - left.traces)[0],
      trend: this.#trend({ projects, folds, before }),
      users: new Map(users.map((user) => [user.userId, user])),
      update: updates.find((update) => update.isoWeek === isoWeek),
    };
  }

  /** What the pick reads for one member. Project numbers are the organization's busiest project. */
  templateInput({
    week,
    userId,
    admin,
  }: {
    week: OrganizationWeek;
    userId: string;
    admin: boolean;
  }): TemplateInput {
    const user = week.users.get(userId);
    return {
      admin,
      planUsagePercent: week.planUsagePercent,
      codingAgentSessions: user ? userWeekTotals(user).sessions : 0,
      traces: week.busiest?.traces ?? 0,
      scenarioTrend: week.trend?.trend ?? null,
    };
  }

  #trend({
    projects,
    folds,
    before,
  }: {
    projects: readonly ProjectWeekState[];
    folds: readonly ProjectWeekState[];
    before: readonly string[];
  }): OrganizationWeek["trend"] {
    for (const project of projects.toSorted((a, b) => b.scenarios.runs - a.scenarios.runs)) {
      const baseline = before.map(
        (week) =>
          folds.find((fold) => fold.projectId === project.projectId && fold.isoWeek === week)
            ?.scenarios ?? { runs: 0, passed: 0, failed: 0 },
      );
      const trend = scenarioTrendOf({ thisWeek: project.scenarios, baseline });
      if (trend) return { project, trend };
    }
    return undefined;
  }
}
