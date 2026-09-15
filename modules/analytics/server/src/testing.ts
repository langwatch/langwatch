import {
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "./services/langwatch-ql.service.ts";

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
 * The recording LangWatchQL executor: a statement is captured rather than
 * issued, so a suite can assert what a surface would have run without a
 * restricted identity to run it as.
 */
export {
  recordingExecutor,
  type RecordingLangWatchQLExecutor,
} from "./fixtures/langwatch-ql-executor.fixture.ts";
