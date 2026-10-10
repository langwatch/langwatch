import type { DashboardApi } from "@langwatch/dashboard-contract";
import {
  type ConfigureInsightDailyRunInput,
  configureInsightDailyRunInputSchema,
  type InsightBoardDailyRunScope,
  type InsightDailyRun,
  type InsightDailyRunSetting,
  type InsightRunBoard,
  type RequestInsightDailyRunInput,
  requestInsightDailyRunInputSchema,
  type TurnOffInsightDailyRunInput,
  turnOffInsightDailyRunInputSchema,
} from "@langwatch/insight-contract";
import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";
import { nowInstant } from "@langwatch/time";

import type { InsightDailyScheduleRepository } from "../repositories/insight-daily-schedule.repository.ts";
import { dailyScheduleId, pointerName } from "../rules/insight-daily-run.rules.ts";
import { UNDECIDED_DAILY_RUN_SETTING } from "../rules/insight-daily-schedule-row.rules.ts";
import type { InsightDailyRunCommandsService } from "./insight-daily-run-commands.service.ts";

type Reader = { userId: string };

type InsightDailyScheduleMembers = Readonly<{
  schedules: InsightDailyScheduleRepository;
  commands: InsightDailyRunCommandsService;
  dashboards: Pick<DashboardApi, "getById">;
}>;

/**
 * A person's daily runs: their setting on a board, asking for one run, and reading how each
 * board's last run ended. Every write only records an event; the worker arms the wake, and
 * whether the person may have a run is decided each time one starts.
 */
export class InsightDailyScheduleService {
  private constructor(private readonly members: InsightDailyScheduleMembers) {}

  static create(members: InsightDailyScheduleMembers): InsightDailyScheduleService {
    return new InsightDailyScheduleService(members);
  }

  /**
   * Records the request and answers its id. The id names no run: the schedule's process starts
   * one for it only when none is in flight for the board, and the worker decides that later.
   */
  async requestRun(input: RequestInsightDailyRunInput): Promise<{ requestId: string }> {
    const { projectId, userId, board, maxInsights } =
      requestInsightDailyRunInputSchema.parse(input);
    const requestId = generate(KSUID_RESOURCES.INSIGHT_RUN).toString();
    await this.members.commands.requestRun({
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
    return this.members.schedules.findForUser(input);
  }

  /** The person's own setting on the board; a board they never decided on reads `undecided`. */
  async getSetting({
    projectId,
    userId,
    board,
  }: InsightBoardDailyRunScope & Reader): Promise<InsightDailyRunSetting> {
    const [setting] = await this.members.schedules.findSetting({
      projectId,
      userId,
      scheduleId: dailyScheduleId({ projectId, userId, board }),
    });
    return setting ?? UNDECIDED_DAILY_RUN_SETTING;
  }

  /**
   * Turns the person's run on for a board they can open now, or changes it. Whether they can
   * still open it later is asked again by every run.
   */
  async configure({ userId, ...input }: ConfigureInsightDailyRunInput & Reader): Promise<void> {
    const { projectId, board, ...settings } = configureInsightDailyRunInputSchema.parse(input);
    const opened = await this.openBoard({ projectId, userId, board });
    await this.members.commands.configureSchedule({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      scheduleId: dailyScheduleId({ projectId, userId, board }),
      userId,
      board: opened,
      ...settings,
    });
  }

  /** Off needs no board: a person turns off the run of a board that is gone, too. */
  async turnOff({ userId, ...input }: TurnOffInsightDailyRunInput & Reader): Promise<void> {
    const { projectId, board } = turnOffInsightDailyRunInputSchema.parse(input);
    await this.members.commands.turnOffSchedule({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      scheduleId: dailyScheduleId({ projectId, userId, board }),
      userId,
      board,
      by: "person",
      reason: null,
    });
  }

  /**
   * The pointer a schedule keeps. A stored board is read as the person, so the dashboard
   * module refuses one they cannot open as not found, and its name is the board's own. A From
   * LangWatch board is defined in the browser alone, so its pointer is kept as it was sent.
   */
  private async openBoard({
    projectId,
    userId,
    board,
  }: {
    projectId: string;
    userId: string;
    board: InsightRunBoard;
  }): Promise<InsightRunBoard> {
    if (board.kind === "template") return board;
    const stored = await this.members.dashboards.getById({
      projectId,
      dashboardId: board.id,
      viewer: { userId },
    });
    return { ...board, name: pointerName({ name: stored.name, fallback: board.id }) };
  }
}
