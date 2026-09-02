/**
 * The shared `LangWatchQLExecutor` fake for every suite that only needs to
 * observe what reached this seam, not what a real database does with it.
 *
 * Records what it was asked to run and answers a fixed small result — the
 * claim worth making about a run is "what reached the database", which is an
 * artifact to inspect rather than a call sequence to verify (never mock what
 * you own). Colocated with `executor.ts`, the interface it implements.
 */

import type {
  LangWatchQLExecutionRequest,
  LangWatchQLExecutionResult,
  LangWatchQLExecutor,
} from "./executor";

export interface RecordingLangWatchQLExecutor extends LangWatchQLExecutor {
  readonly calls: LangWatchQLExecutionRequest[];
}

export function recordingExecutor(
  result: Partial<LangWatchQLExecutionResult> = {},
): RecordingLangWatchQLExecutor {
  const calls: LangWatchQLExecutionRequest[] = [];
  return {
    calls,
    async execute(request) {
      calls.push(request);
      return {
        columns: [{ name: "value", type: "UInt64" }],
        rows: [{ value: 1 }],
        truncated: false,
        statistics: {
          elapsedMs: 3,
          rowsRead: 10,
          bytesRead: 100,
          rowsReturned: 1,
        },
        ...result,
      };
    },
  };
}
