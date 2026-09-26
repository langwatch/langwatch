import {
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "../../services/langwatch-ql.service.ts";

/**
 * The real LangWatchQL service, for a suite that measures a real refusal —
 * built here so a consuming test never names the private service class.
 */
export function createLangWatchQLService(
  dependencies: LangWatchQLServiceDependencies,
): LangWatchQLService {
  return LangWatchQLService.create(dependencies);
}

/**
 * The shared LangWatchQL executor fake for every suite that only needs to observe what reached
 * this seam, not what a real database does with it.
 */
import {
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../../repositories/langwatch-ql-executor.repository.ts";

export class RecordingLangWatchQLExecutor extends LangWatchQLExecutorRepository {
  readonly calls: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly result: Partial<LangWatchQLExecutionResult> = {}) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.calls.push(request);

    return Promise.resolve({
      columns: [{ name: "value", type: "UInt64" }],
      rows: [{ value: 1 }],
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
