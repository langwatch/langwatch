/**
 * The judged half of hydration: one classification per distinct text.
 *
 * The unit of work is a **text**, not a row and not a call. Two facts make that
 * the right grain, and both are measured:
 *
 *  - Several eval functions over the same expression are one request carrying
 *    several questions, which is what keeps a three-question query the price of
 *    a one-question query plus a little envelope.
 *  - Rows are never packed together. The bench measured 98% agreement on single
 *    conversations against 87% with eight packed into one request, so packing
 *    buys a seventh of the cost for eleven points of accuracy, and we do not
 *    take that trade.
 *
 * So the calls are grouped by the expression they judge — which is the nested
 * extraction call and its options, or the column itself where there is none —
 * and then by key. Each group is one request.
 *
 * The whole query's estimated tokens are checked **before anything is sent**.
 * A synchronous query is a caller waiting, and the alternative to refusing a
 * too-large one up front is a caller discovering its size from the bill.
 *
 * @see ../evalQuestions.ts
 * @see ../../../../app-layer/instant-evals/classifier/classifier.ts
 * @see ../../../../../../specs/lwql/eval-functions.feature
 */

import type {
  InstantEvalClassifierLimits,
  InstantEvalJudgement,
  InstantEvalQuestion,
} from "~/server/app-layer/instant-evals/classifier/classifier";
import { estimateInstantEvalRequestTokens } from "~/server/app-layer/instant-evals/classifier/token-budget";
import { InstantEvalQueryBudgetExceededError } from "~/server/app-layer/instant-evals/errors";
import { instantEvalQuestionFor, judgedCellValue } from "../evalQuestions";
import { computeAppFunctionValue } from "./compute";
import {
  type ComputedValue,
  type ComputedValues,
  type InstantEvalHydrationSupport,
  type LangWatchQLEvalUsage,
  NOT_RESOLVED,
  type ResolvedCall,
} from "./contract";
import type { FetchedTraces } from "./read";

/** One text to judge, and every question asked about it. */
interface JudgementUnit {
  readonly text: string;
  readonly keyId: string;
  /** The calls whose cell this unit's verdicts fill. */
  readonly calls: readonly ResolvedCall[];
  readonly questions: readonly InstantEvalQuestion[];
}

export interface EvaluationOutcome {
  readonly values: ComputedValues;
  readonly usage: LangWatchQLEvalUsage;
}

export async function evaluateCalls({
  projectId,
  resolved,
  traces,
  support,
  signal,
}: {
  projectId: string;
  resolved: readonly ResolvedCall[];
  traces: FetchedTraces;
  support: InstantEvalHydrationSupport;
  signal?: AbortSignal;
}): Promise<EvaluationOutcome> {
  const evalCalls = resolved.filter(
    (entry) => entry.definition.kind === "eval",
  );
  const values = emptyValues(evalCalls);
  if (evalCalls.length === 0) {
    return { values, usage: { requests: 0, inputTokens: 0, skipped: {} } };
  }

  const units = await buildUnits({ evalCalls, traces });
  assertQueryBudget({
    units,
    budget: support.queryTokenBudget,
    // The classifier's own, not the shipped constant: the contract says limits
    // are published by the implementation and never assumed, so a classifier
    // with a smaller state cap must be budgeted against that.
    limits: support.classifier.limits,
  });

  const usage = {
    requests: 0,
    inputTokens: 0,
    skipped: {} as Record<string, number>,
  };
  let failures = 0;

  await inParallel({
    items: units,
    limit: support.maxConcurrency,
    ...(signal ? { signal } : {}),
    run: async (unit) => {
      const judgement = await judge({
        projectId,
        unit,
        support,
        ...(signal ? { signal } : {}),
      });
      if (judgement === null) {
        failures += 1;
        // Not an unresolved key: this key found its text and the text was
        // sent. Recording it as a skip with a reason is what keeps the null
        // cell explained by the diagnostic that describes what happened.
        record({
          unit,
          judgement: {
            verdicts: [],
            skippedReason: "classifier_failed",
            inputTokens: 0,
            isTextTruncated: false,
          },
          values,
          usage,
        });
        return;
      }
      record({ unit, judgement, values, usage });
    },
  });

  // Every unit failing is not a row-level problem: it is the classifier not
  // answering at all, and a result of nothing but nulls would read as "nothing
  // matched". The caller turns this into a refusal.
  if (failures > 0 && failures === units.length) {
    throw new ClassifierAnsweredNothingError();
  }
  fillUnjudged({ evalCalls, values });
  return { values, usage };
}

/**
 * Marks every key that never became a unit as unresolved.
 *
 * A key whose extraction produced no text — a conversation id matching no
 * trace, an empty transcript — is exactly the unresolved-key case the
 * extraction functions already report, and it is reported the same way here.
 */
function fillUnjudged({
  evalCalls,
  values,
}: {
  evalCalls: readonly ResolvedCall[];
  values: MutableValues;
}): void {
  for (const entry of evalCalls) {
    const cells = values.get(entry.call.column);
    if (!cells) continue;
    for (const keyId of entry.keys.keys()) {
      if (!cells.has(keyId)) cells.set(keyId, NOT_RESOLVED);
    }
  }
}

/** Raised when no unit was judged, so the caller can refuse the whole query. */
export class ClassifierAnsweredNothingError extends Error {
  constructor() {
    super("the classifier answered nothing for this query");
    this.name = "ClassifierAnsweredNothingError";
  }
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** What makes two calls share a request: the same expression judged. */
function textSignature(entry: ResolvedCall): string {
  return JSON.stringify([
    entry.call.source?.function ?? null,
    entry.call.source?.options ?? [],
  ]);
}

async function buildUnits({
  evalCalls,
  traces,
}: {
  evalCalls: readonly ResolvedCall[];
  traces: FetchedTraces;
}): Promise<JudgementUnit[]> {
  const grouped = new Map<
    string,
    { keyId: string; text: string; calls: ResolvedCall[] }
  >();

  for (const entry of evalCalls) {
    const signature = textSignature(entry);
    for (const [keyId, parts] of entry.keys) {
      const unitId = `${signature}::${keyId}`;
      const existing = grouped.get(unitId);
      if (existing) {
        existing.calls.push(entry);
        continue;
      }
      const text = await textFor({ entry, parts, traces });
      if (text === null || text === "") continue;
      grouped.set(unitId, { keyId, text, calls: [entry] });
    }
  }

  return [...grouped.values()].map((unit) => ({
    keyId: unit.keyId,
    text: unit.text,
    calls: unit.calls,
    questions: unit.calls.map((entry) =>
      instantEvalQuestionFor({
        definition: entry.definition,
        options: entry.call.options,
        column: entry.call.column,
      }),
    ),
  }));
}

/**
 * The text one key judges: the nested extraction's value, or the key itself.
 *
 * A list-valued extraction is serialised rather than refused — `thread_traces`
 * is a strange thing to judge, but the caller wrote it, and the honest text of
 * a list is the list.
 */
async function textFor({
  entry,
  parts,
  traces,
}: {
  entry: ResolvedCall;
  parts: readonly string[];
  traces: FetchedTraces;
}): Promise<string | null> {
  if (!entry.source) return parts[0] ?? null;
  const computed = await computeAppFunctionValue({
    definition: entry.source,
    options: entry.call.source?.options ?? [],
    parts,
    traces,
  });
  if (!computed.isResolved || computed.value === null) return null;
  return typeof computed.value === "string"
    ? computed.value
    : JSON.stringify(computed.value);
}

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

function assertQueryBudget({
  units,
  budget,
  limits,
}: {
  units: readonly JudgementUnit[];
  budget: number;
  limits: InstantEvalClassifierLimits;
}): void {
  let estimatedTokens = 0;
  for (const unit of units) {
    estimatedTokens += estimateInstantEvalRequestTokens({
      text: unit.text,
      questions: unit.questions,
      limits,
    });
  }
  if (estimatedTokens > budget) {
    throw new InstantEvalQueryBudgetExceededError({ estimatedTokens, budget });
  }
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

/**
 * One unit's judgement, or `null` when the classifier could not be used.
 *
 * A cancellation is not a row that failed to be judged, so it is rethrown
 * rather than counted: swallowing it would turn an abandoned query into a
 * result full of nulls and would let the remaining units keep spending.
 */
async function judge({
  projectId,
  unit,
  support,
  signal,
}: {
  projectId: string;
  unit: JudgementUnit;
  support: InstantEvalHydrationSupport;
  signal?: AbortSignal;
}): Promise<InstantEvalJudgement | null> {
  try {
    return await support.classifier.classify(
      { projectId, text: unit.text, questions: unit.questions },
      signal,
    );
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw error;
    return null;
  }
}

/** Whether a thrown value is a cancellation rather than a failure. */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function record({
  unit,
  judgement,
  values,
  usage,
}: {
  unit: JudgementUnit;
  judgement: InstantEvalJudgement;
  values: MutableValues;
  usage: {
    requests: number;
    inputTokens: number;
    skipped: Record<string, number>;
  };
}): void {
  usage.requests += 1;
  usage.inputTokens += judgement.inputTokens;
  if (judgement.skippedReason) {
    usage.skipped[judgement.skippedReason] =
      (usage.skipped[judgement.skippedReason] ?? 0) + 1;
  }

  const byQuestion = new Map(
    judgement.verdicts.map((verdict) => [verdict.questionId, verdict]),
  );
  for (const entry of unit.calls) {
    const value = judgedCellValue({
      definition: entry.definition,
      options: entry.call.options,
      verdict: byQuestion.get(entry.call.column),
    });
    // Resolved names the *key*, not the answer: the key found a text and the
    // text was sent. A judgement the classifier skipped leaves the cell null
    // and is reported on its own, so counting it as an unresolved key too
    // would name one event twice under two different causes.
    values.get(entry.call.column)?.set(unit.keyId, {
      value,
      isTruncated: judgement.isTextTruncated,
      isResolved: true,
    });
  }
}

/** The cells being filled in, before they are handed back as read-only. */
type MutableValues = Map<string, Map<string, ComputedValue>>;

function emptyValues(evalCalls: readonly ResolvedCall[]): MutableValues {
  return new Map(
    evalCalls.map((entry) => [
      entry.call.column,
      new Map<string, ComputedValue>(),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

/**
 * Runs the units with a fixed number in flight.
 *
 * A fixed ceiling rather than all at once: the global limiter already paces the
 * deployment, and firing a thousand requests at it would leave a thousand
 * promises parked on it holding their texts in memory.
 */
async function inParallel<T>({
  items,
  limit,
  run,
  signal,
}: {
  items: readonly T[];
  limit: number;
  run: (item: T) => Promise<void>;
  signal?: AbortSignal;
}): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      for (;;) {
        // Checked between units as well as inside the request, so a query the
        // caller walked away from stops before the next classification rather
        // than after the last one.
        signal?.throwIfAborted();
        const index = next++;
        const item = items[index];
        if (item === undefined) return;
        await run(item);
      }
    },
  );
  await Promise.all(workers);
}
