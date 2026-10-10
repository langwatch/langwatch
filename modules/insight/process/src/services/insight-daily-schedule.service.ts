import {
  type InsightDailyRun,
  type RequestInsightDailyRunInput,
  requestInsightDailyRunInputSchema,
} from "@langwatch/insight-contract";
import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import type { InsightDailyScheduleRepository } from "../repositories/insight-daily-schedule.repository.ts";
import { dailyScheduleId } from "../rules/insight-daily-run.rules.ts";
import type { InsightDailyRunCommandsService } from "./insight-daily-run-commands.service.ts";

/**
 * A person's daily runs: asking for one, and reading how each board's last run ended. Asking
 * only records the request; whether the person may have the run is decided when it starts.
 */
export class InsightDailyScheduleService {
  private constructor(
    private readonly schedules: InsightDailyScheduleRepository,
    private readonly commands: InsightDailyRunCommandsService,
  ) {}

  static create({
    schedules,
    commands,
  }: {
    schedules: InsightDailyScheduleRepository;
    commands: InsightDailyRunCommandsService;
  }): InsightDailyScheduleService {
    return new InsightDailyScheduleService(schedules, commands);
  }

  /**
   * Records the request and answers its id. The id names no run: the schedule's process starts
   * one for it only when none is in flight for the board, and the worker decides that later.
   */
  async requestRun(input: RequestInsightDailyRunInput): Promise<{ requestId: string }> {
    const { projectId, userId, board, maxInsights } =
      requestInsightDailyRunInputSchema.parse(input);
    const requestId = generate(KSUID_RESOURCES.INSIGHT_RUN).toString();
    await this.commands.requestRun({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      scheduleId: dailyScheduleId({ projectId, userId, board }),
      userId,
      board,
      requestId,
      maxInsights,
    });
    return { requestId };
  }

  findForUser(input: { projectId: string; userId: string }): Promise<InsightDailyRun[]> {
    return this.schedules.findForUser(input);
  }
}
