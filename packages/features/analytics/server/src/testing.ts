
/**
 * The recording LangWatchQL executor: a statement is captured rather than
 * issued, so a suite can assert what a surface would have run without a
 * restricted identity to run it as.
 */
export {
  recordingExecutor,
  type RecordingLangWatchQLExecutor,
} from "./langwatch-ql/executor.test-fakes";
