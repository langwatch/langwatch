import type { DashboardApi } from "@langwatch/dashboard-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  type ConfigureInsightDailyRunInput,
  configureInsightDailyRunInputSchema,
  INSIGHT_DAILY_RUN_EXPIRY_MS,
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

const DAILY_RUN_NOT_ON = "Turn this board's daily insights on before running them now.";

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

  /**
   * Run now, as the person asks it: refused unless their run on the board is on. A run already
   * in flight answers its own id and requests nothing, since the process would start none; the
   * caller follows that run. An operator's run is asked through {@link requestRun}.
   */
  async runNow(input: RequestInsightDailyRunInput): Promise<{ requestId: string }> {
    const { state, runInFlight } = await this.getSetting(input);
    // The presentation reads `formErrors`, so the caller is told what to do, not only the code.
    if (state !== "on") {
      throw new ValidationError(DAILY_RUN_NOT_ON, { meta: { formErrors: [DAILY_RUN_NOT_ON] } });
    }
    if (runInFlight !== null) return { requestId: runInFlight.runId };
    return this.requestRun(input);
  }

  findForUser(input: { projectId: string; userId: string }): Promise<InsightDailyRun[]> {
    return this.members.schedules.findForUser(input);
  }

  /**
   * The person's own setting on the board; a board they never decided on reads `undecided`. A
   * run that started longer ago than a run may take is lost, so it is no run in flight.
   */
  async getSetting({
    projectId,
    userId,
    board,
  }: InsightBoardDailyRunScope & Reader): Promise<InsightDailyRunSetting> {
    const [setting = UNDECIDED_DAILY_RUN_SETTING] = await this.members.schedules.findSetting({
      projectId,
      userId,
      scheduleId: dailyScheduleId({ projectId, userId, board }),
    });
    const { runInFlight } = setting;
    const isLost =
      runInFlight !== null &&
      nowInstant().epochMilliseconds - runInFlight.startedAt >= INSIGHT_DAILY_RUN_EXPIRY_MS;
    return isLost ? { ...setting, runInFlight: null } : setting;
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
