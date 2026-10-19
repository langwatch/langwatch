/**
 * The board check of a daily run: runs each widget's stored statements as the person, with no
 * model call, and files or renews one card per widget that fails or shows no data. A failure
 * of ours files nothing, and the check never ends the run.
 * @see modules/insight/adrs/005-board-health-check.md
 */

import type { AnalyticsApi, LangWatchQLRunCaller } from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";
import { defaultBoardExcludedOrigins } from "@langwatch/trace-contract";

import type { InsightRepository } from "../repositories/insight.repository.ts";
import {
  BOARD_HEALTH_TOPIC,
  BOARD_HEALTH_VALID_DAYS,
  type BoardHealthAct,
  boardHealthCards,
  type BrokenWidget,
  classifyStatementFailure,
  decideBoardHealthActs,
  type HealthStatement,
  isPlatformWide,
  readResult,
  type StatementOutcome,
  statementParameters,
  type WidgetHealth,
  widgetHealth,
} from "../rules/insight-board-health.rules.ts";
import { boardHealthInsightId } from "../rules/insight-daily-run.rules.ts";
import type { InsightCommandsService } from "./insight-commands.service.ts";
import type { InsightDailyRunMetricsService } from "./insight-daily-run-metrics.service.ts";

const logger = createLogger("langwatch:insight:board-health");

/** The board's default range, which the owner chose for the check. */
const CHECK_PERIOD_DAYS = 30;
/** The board's "auto" step for 30 days. */
const CHECK_GRANULARITY_SECONDS = 86_400;
/** No statement starts after this; with Langy's 10 minutes the run stays inside its lease. */
const CHECK_BUDGET_MS = 3 * 60_000;

export type BoardHealthWidget = Readonly<{
  id: string;
  name: string;
  statements: readonly HealthStatement[];
}>;

export type BoardHealthCheckInput = Readonly<{
  projectId: string;
  userId: string;
  scheduleId: string;
  runId: string;
  slot: number;
  board: Readonly<{ id: string; name: string }>;
  /** In board order. */
  widgets: readonly BoardHealthWidget[];
  isPersonalProject: boolean;
  /** Where the run's window ends: the check reads the 30 days before it. */
  periodEnd: number;
}>;

/** What the check wrote, and the widgets it reported, for the run's counts and Langy's brief. */
export type BoardHealthReport = Readonly<{
  filedCount: number;
  renewedCount: number;
  reported: readonly Readonly<{ id: string; name: string }>[];
}>;

export const NO_BOARD_HEALTH: BoardHealthReport = { filedCount: 0, renewedCount: 0, reported: [] };

type Statement = Readonly<{ sql: string; values: Record<string, unknown> }>;

/** Why the loop stopped early: the board cannot run queries, or the budget ran out. */
type Stop = "off" | "budget";

type InsightBoardHealthMembers = Readonly<{
  analytics: Pick<
    AnalyticsApi,
    | "isWorkbenchEnabled"
    | "resolveRunCaller"
    | "validateLangWatchQL"
    | "describeLangWatchQLJudgements"
    | "executeBackgroundLangWatchQL"
  >;
  insights: Pick<InsightRepository, "findByFindingKeys">;
  commands: Pick<InsightCommandsService, "fileInsight" | "renewInsight">;
  metrics: Pick<InsightDailyRunMetricsService, "boardHealthChecked">;
  /** Injected by tests that cannot wait for a query window to open. */
  pause?: (ms: number) => Promise<void>;
}>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One check's run state: the caller, the period, and the clock its budget reads. */
type CheckContext = Readonly<{
  input: BoardHealthCheckInput;
  caller: LangWatchQLRunCaller;
  startedAt: number;
}>;

export class InsightBoardHealthService {
  private constructor(private readonly members: InsightBoardHealthMembers) {}

  static create(members: InsightBoardHealthMembers): InsightBoardHealthService {
    return new InsightBoardHealthService(members);
  }

  /** Never throws: what it could not read files nothing, and a failed write is logged. */
  async check(input: BoardHealthCheckInput): Promise<BoardHealthReport> {
    const { analytics, metrics } = this.members;
    const { projectId, userId } = input;
    const startedAt = nowInstant().epochMilliseconds;
    let caller: LangWatchQLRunCaller | undefined;
    try {
      // The board runs its widgets through the Workbench door: where that is shut, so is the check.
      if (await analytics.isWorkbenchEnabled({ projectId })) {
        caller = await analytics.resolveRunCaller({ userId, projectId });
      }
    } catch (error) {
      logger.warn({ error, projectId }, "board check could not start");
      return NO_BOARD_HEALTH;
    }
    const read = caller ? await this.readWidgets({ input, caller, startedAt }) : "off";
    if (read === "off") {
      metrics.boardHealthChecked({ result: "off" });
      return NO_BOARD_HEALTH;
    }
    try {
      return await this.report({ input, read });
    } catch (error) {
      // A failed read or write of the cards must not cost Langy's run; the next run renews.
      logger.warn({ error, projectId }, "board check could not report");
      return NO_BOARD_HEALTH;
    }
  }

  private async readWidgets(
    context: CheckContext,
  ): Promise<"off" | readonly { widget: BoardHealthWidget; outcomes: StatementOutcome[] }[]> {
    const read: { widget: BoardHealthWidget; outcomes: StatementOutcome[] }[] = [];
    let stop: Stop | undefined;
    for (const widget of context.input.widgets) {
      const outcomes: StatementOutcome[] = [];
      for (const statement of widget.statements) {
        if (stop) {
          outcomes.push({ kind: "unchecked" });
          continue;
        }
        const outcome = await this.readStatement({ context, statement });
        if (outcome === "off") return "off";
        if (outcome === "budget") stop = "budget";
        outcomes.push(outcome === "budget" ? { kind: "unchecked" } : outcome);
      }
      read.push({ widget, outcomes });
    }
    return read;
  }

  /** One statement: admitted, recognised as costing no model call, then run as the board does. */
  private async readStatement({
    context,
    statement,
  }: {
    context: CheckContext;
    statement: HealthStatement;
  }): Promise<StatementOutcome | Stop> {
    const parameters = statementParameters(statement);
    if (!parameters.runnable) return { kind: "unchecked" };
    const prepared = { sql: statement.sql, values: parameters.values };
    try {
      if (this.callsAJudge({ context, statement: prepared })) return { kind: "unchecked" };
      return await this.execute({ context, statement: prepared });
    } catch (error) {
      const failure = classifyStatementFailure(error);
      if (failure.kind === "off") return "off";
      if (failure.kind === "window_full") return "budget";
      if (failure.kind === "platform") {
        logger.warn({ error, projectId: context.input.projectId }, "board check statement failed");
      }
      return failure;
    }
  }

  /** Validated with the eval gate open, so an eval call is recognised rather than refused. */
  private callsAJudge({
    context,
    statement,
  }: {
    context: CheckContext;
    statement: Statement;
  }): boolean {
    const { analytics } = this.members;
    const accepted = analytics.validateLangWatchQL({
      projectId: context.input.projectId,
      protections: context.caller.protections,
      sql: statement.sql,
      parameters: statement.values,
      timeWindow: this.timeWindow(context.input),
      isInstantEvalsEnabled: true,
    });
    return analytics.describeLangWatchQLJudgements(accepted).length > 0;
  }

  /**
   * Runs the statement as a background caller. A full query window answers when it opens
   * again: the check waits for it and runs the statement again, unless that outlasts its budget.
   */
  private async execute({
    context,
    statement,
  }: {
    context: CheckContext;
    statement: Statement;
  }): Promise<StatementOutcome | Stop> {
    const { analytics, pause = sleep } = this.members;
    const { input, caller, startedAt } = context;
    const deadline = startedAt + CHECK_BUDGET_MS;
    while (nowInstant().epochMilliseconds < deadline) {
      try {
        const result = await analytics.executeBackgroundLangWatchQL({
          ...caller,
          sql: statement.sql,
          parameters: statement.values,
          timeWindow: this.timeWindow(input),
          granularitySeconds: CHECK_GRANULARITY_SECONDS,
          onBudgetOverflow: "coarsen",
          excludeOrigins: defaultBoardExcludedOrigins({
            isPersonalProject: input.isPersonalProject,
          }),
        });
        return readResult(result);
      } catch (error) {
        const failure = classifyStatementFailure(error);
        if (failure.kind !== "window_full") throw error;
        const waitMs = failure.retryAfterSeconds * 1000;
        if (nowInstant().epochMilliseconds + waitMs >= deadline) return "budget";
        await pause(waitMs);
      }
    }
    return "budget";
  }

  private timeWindow({ periodEnd }: BoardHealthCheckInput): { start: string; end: string } {
    const end = Temporal.Instant.fromEpochMilliseconds(periodEnd);
    const start = end.subtract({ hours: CHECK_PERIOD_DAYS * 24 });
    return { start: start.toString(), end: end.toString() };
  }

  private async report({
    input,
    read,
  }: {
    input: BoardHealthCheckInput;
    read: readonly { widget: BoardHealthWidget; outcomes: StatementOutcome[] }[];
  }): Promise<BoardHealthReport> {
    // One code failing most of what ran is ours, whatever it says: the check then files nothing.
    const platformWide = isPlatformWide(read.flatMap(({ outcomes }) => outcomes));
    const health = read.map(({ widget, outcomes }) => {
      const result = widgetHealth(outcomes);
      const broken = result === "error" || result === "no_data";
      const read: WidgetHealth = platformWide && broken ? "platform" : result;
      return { widget, outcomes, health: read };
    });
    for (const { health: result } of health) this.members.metrics.boardHealthChecked({ result });
    const broken = health.flatMap(({ widget, outcomes, health: result }) =>
      brokenWidget({ widget, outcomes, health: result }),
    );
    if (broken.length === 0) return NO_BOARD_HEALTH;
    const acts = await this.decide({ input, broken });
    for (const act of acts) await this.write({ input, act });
    const filedCount = acts.filter((act) => act.kind === "file").length;
    return {
      filedCount,
      renewedCount: acts.length - filedCount,
      reported: broken.map(({ widget }) => ({ id: widget.id, name: widget.name })),
    };
  }

  private async decide({
    input,
    broken,
  }: {
    input: BoardHealthCheckInput;
    broken: readonly BrokenWidget[];
  }): Promise<BoardHealthAct[]> {
    const { projectId, userId, scheduleId, runId, slot, board } = input;
    const cards = boardHealthCards({ boardId: board.id, broken });
    const existing = await this.members.insights.findByFindingKeys({
      projectId,
      userId,
      findingKeys: cards.map(({ key }) => key),
    });
    return decideBoardHealthActs({
      cards,
      existing,
      boardId: board.id,
      slot,
      insightIdOf: (key) => boardHealthInsightId({ scheduleId, runId, key }),
    });
  }

  /** Stamped with the run's slot, so a retry writes the same event. */
  private async write({
    input,
    act,
  }: {
    input: BoardHealthCheckInput;
    act: BoardHealthAct;
  }): Promise<void> {
    const { projectId, userId, slot, board } = input;
    const { card } = act;
    const envelope = { tenantId: projectId, occurredAt: slot };
    if (act.kind === "renew") {
      await this.members.commands.renewInsight({
        ...envelope,
        insightId: act.insight.id,
        body: card.body,
        tone: card.tone,
        validDays: BOARD_HEALTH_VALID_DAYS,
        replay: null,
        source: null,
      });
      return;
    }
    await this.members.commands.fileInsight({
      ...envelope,
      insightId: act.insightId,
      title: card.title,
      body: card.body,
      tone: card.tone,
      topic: BOARD_HEALTH_TOPIC,
      validDays: BOARD_HEALTH_VALID_DAYS,
      lwql: null,
      replay: null,
      source: null,
      board: { ...board, widget: card.widget },
      filedVia: "run",
      ownerUserId: userId,
      filedByUserId: null,
      findingKey: card.key,
    });
  }
}

function brokenWidget({
  widget,
  outcomes,
  health,
}: {
  widget: BoardHealthWidget;
  outcomes: readonly StatementOutcome[];
  health: WidgetHealth;
}): BrokenWidget[] {
  const pointer = { id: widget.id, name: widget.name };
  if (health === "no_data") return [{ widget: pointer, reason: "no_data" }];
  if (health !== "error") return [];
  const failure = outcomes.find((outcome) => outcome.kind === "error");
  return [
    {
      widget: pointer,
      reason: "error",
      ...(failure?.kind === "error"
        ? { failure: { code: failure.code, message: failure.message } }
        : {}),
    },
  ];
}
