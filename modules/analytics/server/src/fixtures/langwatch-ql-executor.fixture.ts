/**
 * The shared LangWatchQL executor fake for every suite that only needs to observe what reached
 * this seam, not what a real database does with it.
 */
import {
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorPort,
} from "../ports/langwatch-ql-executor.port.ts";

export class RecordingLangWatchQLExecutor extends LangWatchQLExecutorPort {
  readonly calls: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly result: Partial<LangWatchQLExecutionResult> = {}) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.calls.push(request);

    return Promise.resolve({
      columns: [{ name: "value", type: "UInt64" }],
      rows: [{ value: 1 }],
      truncated: false,
      statistics: {
        elapsedMs: 3,
        rowsRead: 10,
        bytesRead: 100,
        rowsReturned: 1,
      },
      ...this.result,
    });
  }
}

export function recordingExecutor(
  result: Partial<LangWatchQLExecutionResult> = {},
): RecordingLangWatchQLExecutor {
  return new RecordingLangWatchQLExecutor(result);
}
