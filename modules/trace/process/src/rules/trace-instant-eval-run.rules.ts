/**
 * The Explorer's Instant Eval, in the run service's own words: what the search
 * bar sends becomes a shorthand statement, and a run row becomes the counters
 * a chip reads. Pure — the peer call itself is the service's.
 */
import type {
  InstantEvalRunInput,
  InstantEvalRunProgress,
  InstantEvalRunWindow,
  InstantEvalRunWire,
} from "@langwatch/instant-eval-contract";
import { Temporal } from "@langwatch/time";
import {
  combineQueries,
  explorerHiddenOrigins,
  queryWithoutInstantEvalChips,
  type ExplorerInstantEvalRunInput,
  type ResolvedInstantEvalRun,
} from "@langwatch/trace-contract";

/** The one question an Explorer run asks, named by the column it writes. */
const EXPLORER_QUESTION_ID = "matched";

/**
 * The filter a run judges: the other chips, minus any eval chip (a run holds no
 * reference for another chip's question) and minus the origins the Explorer
 * hides. @see specs/traces-v2/instant-eval-search.feature
 */
export function explorerJudgedFilter(filter: string): string {
  const scope = queryWithoutInstantEvalChips(filter);

  return combineQueries({
    base: scope,
    addition: explorerHiddenOrigins(scope)
      .map((origin) => `NOT origin:${origin}`)
      .join(" AND "),
  });
}

/** The run service's input for what the Explorer asked. */
export function toExplorerRunInput(input: ExplorerInstantEvalRunInput): InstantEvalRunInput {
  return {
    shorthand: {
      target: input.target,
      filter: explorerJudgedFilter(input.filter),
      start: Temporal.Instant.fromEpochMilliseconds(input.window.from).toString(),
      end: Temporal.Instant.fromEpochMilliseconds(input.window.to).toString(),
      questions: [
        {
          id: EXPLORER_QUESTION_ID,
          kind: "boolean",
          instructions: input.question.instructions,
          ...(input.question.criteria ? { criteria: [...input.question.criteria] } : {}),
        },
      ],
    },
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  };
}

/** A checked run as the filter compiler binds it: its window in epoch milliseconds. */
export function toResolvedInstantEvalRun(window: InstantEvalRunWindow): ResolvedInstantEvalRun {
  return {
    question: window.question,
    target: window.target,
    runId: window.runId,
    writtenFrom: window.writtenFrom.epochMilliseconds,
    writtenUntil: window.writtenUntil.epochMilliseconds,
  };
}

/** A run row as the chip and the progress bar read it: counters and nothing else. */
export function toExplorerRunProgress(run: InstantEvalRunWire): InstantEvalRunProgress {
  return {
    id: run.id,
    status: run.status,
    total: run.total,
    progress: run.progress,
    matched: run.matched,
    failed: run.failed,
    skipped: run.skipped,
    error: run.error,
    priceUsd: run.priceUsd,
    finishedAtMs:
      run.finishedAt === null ? null : Temporal.Instant.from(run.finishedAt).epochMilliseconds,
  };
}
