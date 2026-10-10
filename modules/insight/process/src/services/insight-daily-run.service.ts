/**
 * Carries out one daily run: asks whether the person may have it, briefs Langy, waits, checks
 * the answer, files what holds up and records how it ended. The outbox may run it twice, so
 * every id, date and filing is derived from the run and a repeat writes the same facts.
 * @see modules/insight/adrs/004-daily-run.md
 */

import { HandledError } from "@langwatch/handled-error";
import type {
  InsightRunBoard,
  InsightRunFailureReason,
  InsightRunOutcome,
  InsightRunReason,
} from "@langwatch/insight-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type {
  InsightDailyRunExecutor,
  RunBoardIntent,
} from "../eventing/insight-daily-run.intent.ts";
import type { InsightRepository } from "../repositories/insight.repository.ts";
import { type CheckedFinding, checkRunAnswer } from "../rules/insight-daily-run-answer.rules.ts";
import { buildDailyRunBrief } from "../rules/insight-daily-run-brief.rules.ts";
import {
  DAILY_RUN_GRANULARITY_SECONDS,
  type DailyRunWindows,
  dailyRunConversationTitle,
  dailyRunWindows,
  openInsightsOfBoard,
  runInsightId,
} from "../rules/insight-daily-run.rules.ts";
import type { InsightCommandsService } from "./insight-commands.service.ts";
import type { InsightDailyRunCommandsService } from "./insight-daily-run-commands.service.ts";
import type { InsightRunGateService, RunGateResult } from "./insight-run-gate.service.ts";

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

/** Langy's refusals that no retry changes: each ends the run with its own reason. */
const START_REFUSALS: Readonly<Record<string, Pick<RunEnd, "outcome" | "reason">>> = {
  langy_unattended_actor_missing: { outcome: "skipped", reason: "user_missing" },
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
  return { outcome: "failed", reason, filedCount: 0, conversationId };
}

type InsightDailyRunMembers = Readonly<{
  gate: Pick<InsightRunGateService, "check">;
  langy: Pick<LangyApi, "startUnattendedTurn" | "awaitTurnSettlement" | "stopTurn">;
  insights: Pick<InsightRepository, "findForReader">;
  insightCommands: Pick<InsightCommandsService, "fileInsight">;
  runCommands: Pick<InsightDailyRunCommandsService, "recordRunStarted" | "settleRun">;
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
    let conversationId: string | null = null;
    try {
      const ready = await this.prepare(input);
      if ("outcome" in ready) return await this.settle(input, ready);
      const turn = await this.start(input, ready);
      if ("outcome" in turn) return await this.settle(input, { ...turn, board: ready.board });
      conversationId = turn.conversationId;
      const end = await this.finish(input, ready, turn);
      await this.settle(input, { ...end, board: ready.board });
    } catch (error) {
      if (!input.isFinalAttempt) throw error;
      logger.warn({ error, projectId: input.projectId, runId: input.runId }, "daily run failed");
      const reason = codeOf(error) === "langy_turns_rate_limited" ? "rate_limited" : "error";
      await this.settle(input, failed(reason, conversationId));
      throw error;
    }
  }

  private async prepare(input: RunInput): Promise<ReadyRun | RunEnd> {
    const { projectId, userId, board, slot } = input;
    const gate = await this.members.gate.check({ projectId, userId, board });
    if (!gate.ok) {
      return { outcome: "skipped", reason: gate.reason, filedCount: 0, conversationId: null };
    }
    return {
      gate,
      // The pointer keeps the board's name as the run found it.
      board: { ...board, name: gate.board.name },
      windows: dailyRunWindows({ slot, timezone: RUN_TIMEZONE }),
    };
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
    const entries = await this.members.insights.findForReader({
      projectId,
      userId,
      limit: OPEN_INSIGHTS_READ_LIMIT,
    });
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
      return { ...refusal, filedCount: 0, conversationId: null } satisfies RunEnd;
    }
  }

  private async finish(input: RunInput, ready: ReadyRun, turn: StartedTurn): Promise<RunEnd> {
    const { projectId, userId, maxInsights } = input;
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
      maxInsights,
      widgets: ready.gate.widgets,
    });
    if (!answer.ok) return failed("bad_output", conversationId);
    for (const [position, finding] of answer.findings.entries()) {
      await this.file({
        input,
        ready,
        finding,
        position,
        source: { conversationId, messageId: settlement.messageId },
      });
    }
    const filedCount = answer.findings.length;
    return {
      outcome: filedCount > 0 ? "filed" : "nothing",
      reason: null,
      filedCount,
      conversationId,
    };
  }

  /**
   * The module's one write for a run. The owner, the project and the board come from the run
   * and never from the answer; the id and the instant are the run's, so a repeat files nothing new.
   */
  private async file({
    input,
    ready,
    finding,
    position,
    source,
  }: {
    input: RunInput;
    ready: ReadyRun;
    finding: CheckedFinding;
    position: number;
    source: { conversationId: string; messageId: string };
  }): Promise<void> {
    const { projectId, userId, scheduleId, runId, slot } = input;
    const { widget, ...words } = finding;
    const { start, end } = ready.windows.window;
    await this.members.insightCommands.fileInsight({
      tenantId: projectId,
      occurredAt: slot,
      insightId: runInsightId({ scheduleId, runId, position }),
      ...words,
      replay:
        words.lwql === null
          ? null
          : {
              start,
              end,
              granularitySeconds: DAILY_RUN_GRANULARITY_SECONDS,
              period: null,
              parameters: {},
            },
      source,
      board: { ...ready.gate.board, widget },
      filedVia: "run",
      ownerUserId: userId,
      filedByUserId: null,
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

  private async settle(input: RunInput, end: RunEnd): Promise<void> {
    const { projectId, scheduleId, userId, runId, slot } = input;
    const { board = input.board, ...result } = end;
    await this.members.runCommands.settleRun({
      tenantId: projectId,
      occurredAt: nowInstant().epochMilliseconds,
      scheduleId,
      userId,
      board,
      runId,
      slot,
      ...result,
    });
  }
}
