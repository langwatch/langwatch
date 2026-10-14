import {
  INSIGHT_SCHEDULE_SKIPPED_DAYS_BEFORE_OFF,
  type InsightApi,
  type InsightOperatorDailySchedule,
} from "@langwatch/insight-contract";
import type { OpsInsightSchedule } from "@langwatch/ops-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

const iso = (instant: number): string => Temporal.Instant.fromEpochMilliseconds(instant).toString();

/**
 * The operator view over insight's daily schedules: each one with the name of its project and
 * of its owner. Read only: a schedule is its person's own setting, and insight owns every write.
 */
export class InsightScheduleOpsService {
  private constructor(
    private readonly insights: Pick<InsightApi, "findOperatorDailySchedules">,
    private readonly projects: Pick<ProjectApi, "listNamesByIds">,
    private readonly users: Pick<UserApi, "getProfiles">,
  ) {}

  static create({
    insights,
    projects,
    users,
  }: {
    insights: Pick<InsightApi, "findOperatorDailySchedules">;
    projects: Pick<ProjectApi, "listNamesByIds">;
    users: Pick<UserApi, "getProfiles">;
  }): InsightScheduleOpsService {
    return new InsightScheduleOpsService(insights, projects, users);
  }

  async list({ limit = 200 }: { limit?: number }): Promise<OpsInsightSchedule[]> {
    const schedules = await this.insights.findOperatorDailySchedules({
      limit: Math.min(Math.max(limit, 1), 500),
    });
    const [projectNames, owners] = await Promise.all([
      this.projectNames(schedules),
      this.ownerLabels(schedules),
    ]);

    return schedules.map((schedule) => ({
      id: schedule.scheduleId,
      projectId: schedule.projectId,
      projectName: projectNames.get(schedule.projectId) ?? null,
      userId: schedule.userId,
      owner: owners.get(schedule.userId) ?? null,
      boardKind: schedule.board.kind,
      boardId: schedule.board.id,
      boardName: schedule.board.name,
      on: schedule.state === "on",
      offReason: schedule.offReason,
      hour: schedule.settings?.hour ?? null,
      timezone: schedule.settings?.timezone ?? null,
      nextRunAt: schedule.nextRunAt === null ? null : iso(schedule.nextRunAt),
      lastRunAt: schedule.lastRun === null ? null : iso(schedule.lastRun.at),
      lastRunOutcome: schedule.lastRun?.outcome ?? null,
      lastRunReason: schedule.lastRun?.reason ?? null,
      consecutiveSkips: schedule.consecutiveSkips,
      skippedDaysBeforeOff: INSIGHT_SCHEDULE_SKIPPED_DAYS_BEFORE_OFF,
    }));
  }

  /** A project that is gone, or a read that failed, names none: the row shows its id. */
  private async projectNames(
    schedules: readonly InsightOperatorDailySchedule[],
  ): Promise<Map<string, string>> {
    const projectIds = [...new Set(schedules.map(({ projectId }) => projectId))];
    if (projectIds.length === 0) return new Map();
    try {
      const projects = await this.projects.listNamesByIds({ projectIds });

      return new Map(projects.map((project) => [project.id, project.name]));
    } catch {
      return new Map();
    }
  }

  /** Name, else address; an account that is gone, or has neither, names no one. */
  private async ownerLabels(
    schedules: readonly InsightOperatorDailySchedule[],
  ): Promise<Map<string, string>> {
    const userIds = [...new Set(schedules.map(({ userId }) => userId))];
    if (userIds.length === 0) return new Map();
    const profiles = await this.users.getProfiles({ userIds });

    return new Map(
      profiles.flatMap(({ id, name, email }) => {
        const label = name ?? email;
        return label ? [[id, label] as const] : [];
      }),
    );
  }
}
