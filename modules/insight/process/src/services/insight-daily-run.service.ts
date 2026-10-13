/**
 * Carries out one daily run: asks whether the person may have it, briefs Langy, waits, checks
 * the answer, files what is new, renews what it repeats and records how it ended. The outbox
 * may run it twice, so every id, date and write is the run's own and a repeat writes the same.
 * @see modules/insight/adrs/004-daily-run.md
 */

import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { HandledError } from "@langwatch/handled-error";
import type {
  InsightEntry,
  InsightRunBoard,
  InsightRunFailureReason,
  InsightRunOutcome,
  InsightRunReason,
  InsightScheduleOffReason,
  InsightSource,
} from "@langwatch/insight-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal } from "@langwatch/time";
import { LANGY_TRACE_ORIGIN } from "@langwatch/trace-contract";

import type {
  InsightDailyRunExecutor,
  RunBoardIntent,
} from "../eventing/insight-daily-run.intent.ts";
import type { InsightRepository } from "../repositories/insight.repository.ts";
import { type CheckedFinding, checkRunAnswer } from "../rules/insight-daily-run-answer.rules.ts";
import { buildDailyRunBrief } from "../rules/insight-daily-run-brief.rules.ts";
import {
  type DailyRunWindows,
  dailyRunConversationTitle,
  dailyRunReplay,
  dailyRunWindows,
  decideRunFindings,
  matchableInsightsOfBoard,
  openInsightsOfBoard,
  runInsightId,
} from "../rules/insight-daily-run.rules.ts";
import { isLastSkippedDay } from "../rules/insight-daily-skip-streak.rules.ts";
import type { InsightCommandsService } from "./insight-commands.service.ts";
import type { InsightDailyRunCommandsService } from "./insight-daily-run-commands.service.ts";
import type { InsightDailyRunMetricsService } from "./insight-daily-run-metrics.service.ts";
import type { InsightRunGateService, RunGateResult } from "./insight-run-gate.service.ts";
import type { InsightRunQueryService } from "./insight-run-query.service.ts";

const logger = createLogger("langwatch:insight:daily-run");

/** A run reads calendar days in UTC until a schedule carries the person's own timezone. */
const RUN_TIMEZONE = "UTC";

/** How long a run waits for Langy; shorter than the outbox lease, so the run ends first. */
const TURN_DEADLINE_MS = 10 * 60_000;

/** As many of the person's newest insights as their inbox reads. */
const OPEN_INSIGHTS_READ_LIMIT = 500;

type RunInput = RunBoardIntent & { projectId: string; isFinalAttempt: boolean };

type RunEnd = Readonly<{
  outcome: InsightRunOutcome;
  reason: InsightRunReason | null;
  filedCount: number;
  /** The insights the run found still true and renewed; they are not counted as filed. */
  renewedCount: number;
  conversationId: string | null;
  /** The board as the run read it; absent when it never reached the board. */
  board?: InsightRunBoard;
}>;

type ReadyRun = Readonly<{
  gate: Extract<RunGateResult, { ok: true }>;
  board: InsightRunBoard;
  windows: DailyRunWindows;
}>;

type StartedTurn = Readonly<{ conversationId: string; turnId: string }>;

/** What a run that wrote nothing counts, whatever ended it. */
const NOTHING_WRITTEN = { filedCount: 0, renewedCount: 0 } as const;

/** The run a write belongs to, and the answer it is taken from. */
type RunWrite = Readonly<{ input: RunInput; ready: ReadyRun; source: InsightSource }>;

/** Langy's refusals that no retry changes: each ends the run with its own reason. */
const START_REFUSALS: Readonly<Record<string, Pick<RunEnd, "outcome" | "reason">>> = {
  langy_unattended_actor_missing: { outcome: "skipped", reason: "user_missing" },
  langy_unattended_actor_deactivated: { outcome: "skipped", reason: "no_access" },
  langy_unattended_no_langy_access: { outcome: "skipped", reason: "langy_off" },
  langy_insufficient_scope: { outcome: "skipped", reason: "no_access" },
  aggregate_project_is_read_only: { outcome: "skipped", reason: "project_unavailable" },
  project_not_found: { outcome: "skipped", reason: "project_unavailable" },
  // The same run asked a different question: its inputs changed between two attempts.
  langy_idempotency_mismatch: { outcome: "failed", reason: "brief_changed" },
};

/** The code a peer refused with; empty for a failure that is no refusal. */
function codeOf(error: unknown): string {
  return HandledError.isHandled(error) ? error.code : "";
}

function failed(reason: InsightRunFailureReason, conversationId: string | null): RunEnd {
  return { outcome: "failed", reason, ...NOTHING_WRITTEN, conversationId };
}

/**
 * Whether a run's end turns its schedule off: the board is gone for this person, or this
 * skipped day is one too many in a row. Only a scheduled run carries the days before it.
 */
function turnsScheduleOff({
  end,
  skippedDaysBefore,
}: {
  end: Pick<RunEnd, "outcome" | "reason">;
  skippedDaysBefore: number | undefined;
}): boolean {
  if (end.reason === "board_deleted") return true;
  if (end.outcome !== "skipped" || skippedDaysBefore === undefined) return false;
  return isLastSkippedDay({ skippedDaysBefore });
}

type InsightDailyRunMembers = Readonly<{
  gate: Pick<InsightRunGateService, "check">;
  langy: Pick<LangyApi, "startUnattendedTurn" | "awaitTurnSettlement" | "stopTurn">;
  insights: Pick<InsightRepository, "findForReader">;
  /** The one cheap read before Langy is asked: whether the project took any trace. */
  traces: Pick<AnalyticsApi, "findLastOccurredAt">;
  queries: Pick<InsightRunQueryService, "keepValid">;
  insightCommands: Pick<InsightCommandsService, "fileInsight" | "renewInsight">;
  runCommands: Pick<
    InsightDailyRunCommandsService,
    "recordRunStarted" | "settleRun" | "turnOffSchedule"
  >;
  metrics: Pick<InsightDailyRunMetricsService, "settled">;
  /** Injected by tests that cannot wait ten minutes. */
  turnDeadlineMs?: number;
}>;

export class InsightDailyRunService implements InsightDailyRunExecutor {
  private constructor(private readonly members: InsightDailyRunMembers) {}

  static create(members: InsightDailyRunMembers): InsightDailyRunService {
    return new InsightDailyRunService(members);
  }

  /**
   * A failure is thrown for the outbox to retry, and the last attempt records it first, so a
   * run never ends without an outcome on its row.
   */
  async run(input: RunInput): Promise<void> {
    const startedAt = nowInstant().epochMilliseconds;
    const settle = (end: RunEnd) => this.settle({ input, end, startedAt });
    let conversationId: string | null = null;
    try {
      await this.settleSuperseded(input);
      const ready = await this.prepare(input);
      if ("outcome" in ready) return await settle(ready);
      const turn = await this.start(input, ready);
      if ("outcome" in turn) return await settle({ ...turn, board: ready.board });
      conversationId = turn.conversationId;
      const end = await this.finish(input, ready, turn);
      await settle({ ...end, board: ready.board });
    } catch (error) {
      if (!input.isFinalAttempt) throw error;
      logger.warn({ error, projectId: input.projectId, runId: input.runId }, "daily run failed");
      const reason = codeOf(error) === "langy_turns_rate_limited" ? "rate_limited" : "error";
      await settle(failed(reason, conversationId));
      throw error;
    }
  }

  private async prepare(input: RunInput): Promise<ReadyRun | RunEnd> {
    const { projectId, userId, slot } = input;
    const gate = await this.members.gate.check({ projectId, userId, board: input.board });
    if (!gate.ok) {
      return { outcome: "skipped", reason: gate.reason, ...NOTHING_WRITTEN, conversationId: null };
    }
    // The pointer keeps the board's name as the run found it.
    const board = { ...input.board, name: gate.board.name };
    const windows = dailyRunWindows({ slot, timezone: RUN_TIMEZONE });
    if (!(await this.hasNewTraces({ projectId, windows }))) {
      // Nothing new to read is no skipped day: the person could have had the run.
      const quiet = { outcome: "nothing", reason: "no_new_traces" } as const;
      return { ...quiet, ...NOTHING_WRITTEN, conversationId: null, board };
    }
    return { gate, board, windows };
  }

  /**
   * Asked after the gate and before Langy: a project that took no trace costs no model call.
   * Langy's own traces are left out, so a run's own turn never makes the next day look busy.
   */
  private async hasNewTraces({
    projectId,
    windows,
  }: {
    projectId: string;
    windows: DailyRunWindows;
  }): Promise<boolean> {
    const newest = await this.members.traces.findLastOccurredAt({
      projectId,
      source: "trace",
      since: Temporal.Instant.fromEpochMilliseconds(windows.window.start),
      excludeOrigins: [LANGY_TRACE_ORIGIN],
    });
    return newest.length > 0;
  }

  private async start(input: RunInput, ready: ReadyRun): Promise<StartedTurn | RunEnd> {
    const { projectId, userId, scheduleId, runId, slot } = input;
    const turn = await this.askLangy(input, ready);
    if ("outcome" in turn) return turn;
    await this.members.runCommands.recordRunStarted({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      scheduleId,
      userId,
      board: ready.board,
      runId,
      slot,
      ...turn,
    });
    return turn;
  }

  private async askLangy(input: RunInput, { gate, windows }: ReadyRun) {
    const { projectId, userId, scheduleId, runId, slot, maxInsights } = input;
    const entries = await this.insightsOf(input);
    try {
      return await this.members.langy.startUnattendedTurn({
        projectId,
        userId,
        // The run is the key: a repeat with the same brief is answered with the same turn.
        idempotencyKey: `insight-daily-run:${scheduleId}:${runId}`,
        text: buildDailyRunBrief({
          board: gate.board,
          widgets: gate.widgets,
          windows,
          maxInsights,
          openInsights: openInsightsOfBoard({ entries, boardId: gate.board.id, slot }),
        }),
        title: dailyRunConversationTitle({
          boardName: gate.board.name,
          window: windows.window,
          timezone: RUN_TIMEZONE,
        }),
      });
    } catch (error) {
      const refusal = START_REFUSALS[codeOf(error)];
      if (!refusal) throw error;
      return { ...refusal, ...NOTHING_WRITTEN, conversationId: null } satisfies RunEnd;
    }
  }

  /** The person's newest insights in the project, with their own state on each. */
  private insightsOf({ projectId, userId }: RunInput): Promise<InsightEntry[]> {
    const { insights } = this.members;
    return insights.findForReader({ projectId, userId, limit: OPEN_INSIGHTS_READ_LIMIT });
  }

  private async finish(input: RunInput, ready: ReadyRun, turn: StartedTurn): Promise<RunEnd> {
    const { projectId, userId, maxInsights, slot } = input;
    const { conversationId } = turn;
    const wait = await this.members.langy.awaitTurnSettlement({
      projectId,
      userId,
      ...turn,
      signal: AbortSignal.timeout(this.members.turnDeadlineMs ?? TURN_DEADLINE_MS),
      // Nobody is there to answer: a question ends the run instead of holding it open.
      shouldSettleOnUserWait: true,
    });
    if (wait.kind !== "settled") {
      await this.stop({ projectId, userId, ...turn });
      return failed(wait.kind === "awaiting_user" ? "needs_input" : "timeout", conversationId);
    }
    const { settlement } = wait;
    if (!settlement.succeeded) return failed("turn_failed", conversationId);
    if (settlement.outcome === "stopped") return failed("turn_stopped", conversationId);

    const answer = checkRunAnswer({
      text: settlement.text,
      parts: settlement.parts,
      maxInsights,
      widgets: ready.gate.widgets,
    });
    if (!answer.ok) return failed(answer.reason, conversationId);
    // Asked again: the turn took minutes, and a person who lost access since files nothing.
    const still = await this.members.gate.check({ projectId, userId, board: input.board });
    if (!still.ok) {
      return { outcome: "skipped", reason: still.reason, ...NOTHING_WRITTEN, conversationId };
    }
    const findings = await this.members.queries.keepValid({
      projectId,
      userId,
      window: ready.windows.window,
      findings: answer.findings,
    });
    // Read again: what the person marked done while Langy read is not found again for them.
    const insights = matchableInsightsOfBoard({
      entries: await this.insightsOf(input),
      boardId: ready.gate.board.id,
      slot,
    });
    const acts = decideRunFindings({ findings, insights });
    const write = { input, ready, source: { conversationId, messageId: settlement.messageId } };
    for (const act of acts) {
      if (act.kind === "renew") await this.renew({ ...write, ...act });
      else await this.file({ ...write, ...act });
    }
    const filedCount = acts.filter((act) => act.kind === "file").length;
    return {
      // Seen again is not news: a run that only renewed found nothing new.
      outcome: filedCount > 0 ? "filed" : "nothing",
      reason: null,
      filedCount,
      renewedCount: acts.length - filedCount,
      conversationId,
    };
  }

  /**
   * Files a finding as a new insight. The owner, the project and the board come from the run
   * and never from the answer; the id and the instant are the run's, so a repeat files nothing new.
   */
  private async file({
    input,
    ready,
    finding,
    position,
    source,
  }: RunWrite & { finding: CheckedFinding; position: number }): Promise<void> {
    const { projectId, userId, scheduleId, runId, slot } = input;
    const { widget, renews: _renews, ...words } = finding;
    await this.members.insightCommands.fileInsight({
      tenantId: projectId,
      occurredAt: slot,
      insightId: runInsightId({ scheduleId, runId, position }),
      ...words,
      replay: words.lwql === null ? null : dailyRunReplay({ window: ready.windows.window }),
      source,
      board: { ...ready.gate.board, widget },
      filedVia: "run",
      ownerUserId: userId,
      filedByUserId: null,
    });
  }

  /**
   * Renews the insight a finding repeats: the run's words, validity, window and answer, on the
   * same id. Stamped with the run's slot, so a repeat is the same renewal. The insight keeps
   * its own query and that query's values; nothing here names a reader, so seen stays as it is.
   */
  private async renew({
    input,
    ready,
    finding,
    insight,
    source,
  }: RunWrite & { finding: CheckedFinding; insight: InsightEntry }): Promise<void> {
    const { window } = ready.windows;
    await this.members.insightCommands.renewInsight({
      tenantId: input.projectId,
      occurredAt: input.slot,
      insightId: insight.id,
      body: finding.body,
      tone: finding.tone,
      validDays: finding.validDays,
      replay:
        insight.lwql === null
          ? null
          : dailyRunReplay({ window, parameters: insight.replay?.parameters ?? {} }),
      source,
    });
  }

  /** Best effort: the run's outcome is recorded whether or not the turn could be stopped. */
  private async stop(turn: StartedTurn & { projectId: string; userId: string }): Promise<void> {
    try {
      await this.members.langy.stopTurn(turn);
    } catch (error) {
      logger.warn({ error, ...turn }, "could not stop a daily run's turn");
    }
  }

  /**
   * The run this one replaces never recorded an outcome, so it is recorded as lost before this
   * run's own. A repeat records it once: the outcome is keyed by the run it names.
   */
  private async settleSuperseded(input: RunInput): Promise<void> {
    const { projectId, scheduleId, userId, board, supersedes } = input;
    if (!supersedes) return;
    await this.members.runCommands.settleRun({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      scheduleId,
      userId,
      board,
      ...supersedes,
      ...failed("timeout", null),
    });
    this.members.metrics.settled({ outcome: "failed", reason: "timeout" });
  }

  /**
   * Records how the run ended, and turns its schedule off when that end leaves it nothing to
   * run for. A run the outbox carries out twice is counted twice; its outcome is recorded once.
   */
  private async settle({
    input,
    end,
    startedAt,
  }: {
    input: RunInput;
    end: RunEnd;
    startedAt: number;
  }): Promise<void> {
    const { projectId, scheduleId, userId, runId, slot, skippedDaysBefore } = input;
    const { board = input.board, ...result } = end;
    const envelope = { tenantId: projectId, scheduleId, userId, board };
    const settledAt = nowInstant().epochMilliseconds;
    await this.members.runCommands.settleRun({
      ...envelope,
      occurredAt: settledAt,
      runId,
      slot,
      ...result,
    });
    const { outcome, reason } = result;
    this.members.metrics.settled({ outcome, reason, durationMs: settledAt - startedAt });
    if (!turnsScheduleOff({ end: result, skippedDaysBefore })) return;
    const offReason: InsightScheduleOffReason =
      reason === "board_deleted" ? "board_deleted" : "skipped_days";
    await this.members.runCommands.turnOffSchedule({
      ...envelope,
      occurredAt: nowInstant().epochMilliseconds,
      by: "system",
      reason: offReason,
    });
  }
}
