import type { InsightScheduleOffReason } from "@langwatch/insight-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";

import type { InsightDailyScheduleRepository } from "../repositories/insight-daily-schedule.repository.ts";
import type { InsightOnSchedule } from "../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyRunCommandsService } from "./insight-daily-run-commands.service.ts";

const logger = createLogger("langwatch:insight:daily-schedule-cleanup");

type InsightDailyScheduleCleanupMembers = Readonly<{
  schedules: Pick<InsightDailyScheduleRepository, "findOnInProject">;
  commands: Pick<InsightDailyRunCommandsService, "turnOffSchedule">;
  projects: Pick<ProjectApi, "listIdsByOrganization">;
}>;

/**
 * Turns off the schedules nobody can have any more: a person's when they leave the
 * organisation, a project's when it is archived. Tidying only: the gate keeps a run from
 * starting. Each off is stamped with the fact's own instant, and one already off is left.
 */
export class InsightDailyScheduleCleanupService {
  private constructor(private readonly members: InsightDailyScheduleCleanupMembers) {}

  static create(members: InsightDailyScheduleCleanupMembers): InsightDailyScheduleCleanupService {
    return new InsightDailyScheduleCleanupService(members);
  }

  /** The person's schedules in every project of the organisation they left. */
  async memberRemoved({
    organizationId,
    userId,
    occurredAt,
  }: {
    organizationId: string;
    userId: string;
    occurredAt: number;
  }): Promise<void> {
    const projectIds = await this.members.projects.listIdsByOrganization({ organizationId });
    for (const projectId of projectIds) {
      const schedules = await this.members.schedules.findOnInProject({ projectId, userId });
      await this.turnOff({ schedules, occurredAt, reason: "member_removed" });
    }
  }

  /** Every person's schedule on the archived project's boards. */
  async projectArchived({
    projectId,
    occurredAt,
  }: {
    projectId: string;
    occurredAt: number;
  }): Promise<void> {
    const schedules = await this.members.schedules.findOnInProject({ projectId });
    await this.turnOff({ schedules, occurredAt, reason: "project_archived" });
  }

  private async turnOff({
    schedules,
    occurredAt,
    reason,
  }: {
    schedules: readonly InsightOnSchedule[];
    occurredAt: number;
    reason: InsightScheduleOffReason;
  }): Promise<void> {
    for (const { scheduleId, projectId, userId, board } of schedules) {
      await this.members.commands.turnOffSchedule({
        tenantId: projectId,
        occurredAt,
        scheduleId,
        userId,
        board,
        by: "system",
        reason,
      });
    }
    if (schedules.length === 0) return;
    // The ambient project and person are the caller's: the ones cleaned up are named here.
    const scheduleProjectIds = [...new Set(schedules.map(({ projectId }) => projectId))];
    const scheduleUserIds = [...new Set(schedules.map(({ userId }) => userId))];
    logger.info(
      { reason, count: schedules.length, scheduleProjectIds, scheduleUserIds },
      "turned off daily insight schedules",
    );
  }
}
