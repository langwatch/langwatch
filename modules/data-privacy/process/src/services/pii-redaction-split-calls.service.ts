import { ConcurrencyLimiter } from "@langwatch/limiter";
import type { PIIRedactionLevel } from "@langwatch/trace-contract";

import { failureOutcomeOf, MODEL_CALL_RULES } from "../rules/pii-redaction-model.rules.ts";
import {
  PII_REDACTION_MODEL_ABORTED_SLOT_HOLD_MS,
  type PieceAnswer,
  pieceTextOf,
  type SplitCall,
} from "../rules/pii-redaction-split.rules.ts";
import type { PresidioRedactionService } from "./presidio-redaction.service.ts";

/** How a split span's calls ended: every answer, or the first failure that ends the span. */
type SplitOutcome =
  | Readonly<{ kind: "answered"; answers: PieceAnswer[]; callDurationsMs: number[] }>
  | Readonly<{ kind: "failed"; reason: "timeout" | "throttled" | "error"; error?: unknown }>;

/** What a split span's calls send of its batch. */
type SplitCallsInput = {
  texts: readonly string[];
  piiRedactionLevel: PIIRedactionLevel;
  entities?: readonly string[] | undefined;
  projectId?: string | undefined;
};

/** Split slots a process has: the split row of the context table (ADR-207 decision 9). */
const SPLIT_SLOTS = MODEL_CALL_RULES.split.slots ?? 0;

/**
 * A split span's calls to the one model endpoint (ADR-207) over the process's split slots: the
 * free slots taken at once, never waited for, and one budget for every call of the span.
 */
export class PiiRedactionSplitCallsService {
  static create(input: {
    model: PresidioRedactionService;
    slots?: ConcurrencyLimiter | undefined;
  }): PiiRedactionSplitCallsService {
    return new PiiRedactionSplitCallsService({
      model: input.model,
      slots: input.slots ?? new ConcurrencyLimiter({ maxConcurrent: SPLIT_SLOTS, maxQueued: 0 }),
    });
  }

  private readonly model: PresidioRedactionService;
  /** Per process: the split calls in flight, the same two slots for every span (decision 9). */
  private readonly slots: ConcurrencyLimiter;

  private constructor(input: { model: PresidioRedactionService; slots: ConcurrencyLimiter }) {
    this.model = input.model;
    this.slots = input.slots;
  }

  /** Whether the model's one channel takes split calls (decision 8). */
  canSplit(): boolean {
    return this.model.canSplit();
  }

  /** How many split slots are free now. */
  freeSlots(): number {
    return SPLIT_SLOTS - this.slots.stats().inFlight;
  }

  /**
   * The span's calls over `slots` slots it takes now, each slot running calls one after another.
   * Resolves at the first failure or the budget's end; calls still running finish on their own.
   */
  run({
    input,
    calls,
    slots,
    onUnavailable,
  }: {
    input: SplitCallsInput;
    calls: readonly SplitCall[];
    slots: number;
    onUnavailable: () => void;
  }): Promise<SplitOutcome> {
    const model = this.model;
    const abort = new AbortController();
    return new Promise<SplitOutcome>((resolve) => {
      const run: SplitRun = {
        calls,
        next: 0,
        answers: [],
        callDurationsMs: [],
        ended: false,
        onUnavailable,
        answer: (splitCall) =>
          model.answers({
            pieces: splitCall.pieces,
            textOf: (piece) => pieceTextOf({ texts: input.texts, piece }),
            piiRedactionLevel: input.piiRedactionLevel,
            entities: input.entities,
            projectId: input.projectId,
            signal: abort.signal,
          }),
        end: (outcome) => {
          if (run.ended) return;
          run.ended = true;
          clearTimeout(budget);
          if (outcome.kind === "failed" && outcome.reason === "timeout") abort.abort();
          resolve(outcome);
        },
      };
      const budget = setTimeout(
        () => run.end({ kind: "failed", reason: "timeout" }),
        MODEL_CALL_RULES.split.budgetMs,
      );
      for (let slot = 0; slot < slots; slot++) {
        void this.slots.run({ task: () => runSplitSlot(run) }).catch(() => void 0);
      }
    });
  }
}

/** One split span's calls as its slots share them. */
type SplitRun = {
  readonly calls: readonly SplitCall[];
  next: number;
  readonly answers: PieceAnswer[];
  readonly callDurationsMs: number[];
  ended: boolean;
  readonly answer: (call: SplitCall) => Promise<PieceAnswer[]>;
  readonly end: (outcome: SplitOutcome) => void;
  /** A call timed out or was throttled, even after the span ended: the breaker must hear it. */
  readonly onUnavailable: () => void;
};

/** One slot: the span's next call until none is left, the span ended or a call failed. */
async function runSplitSlot(run: SplitRun): Promise<void> {
  while (!run.ended && run.next < run.calls.length) {
    const splitCall = run.calls[run.next++];
    if (!splitCall || !(await runSplitCall({ run, splitCall }))) return;
  }
}

/**
 * One call; false when it failed. A call our abort rejected keeps its slot until the model's
 * own deadline has passed, so the slots never count as free what the model may still run.
 */
async function runSplitCall({
  run,
  splitCall,
}: {
  run: SplitRun;
  splitCall: SplitCall;
}): Promise<boolean> {
  // Monotonic, as the single call's: a wall-clock step never makes a duration or a hold wrong.
  const startedAt = performance.now();
  try {
    // One answer per piece, or `answers` threw: a missing one fails the span, never stores raw.
    const answered = await run.answer(splitCall);
    run.callDurationsMs.push(Math.round(performance.now() - startedAt));
    run.answers.push(...answered);
    if (run.callDurationsMs.length === run.calls.length) {
      run.end({ kind: "answered", answers: run.answers, callDurationsMs: run.callDurationsMs });
    }
    return true;
  } catch (error) {
    const reason = failureOutcomeOf(error);
    if (reason !== "error") run.onUnavailable();
    run.end({ kind: "failed", reason, error });
    const holdMs = startedAt + PII_REDACTION_MODEL_ABORTED_SLOT_HOLD_MS - performance.now();
    if (reason === "timeout" && holdMs > 0) await new Promise((wake) => setTimeout(wake, holdMs));
    return false;
  }
}
