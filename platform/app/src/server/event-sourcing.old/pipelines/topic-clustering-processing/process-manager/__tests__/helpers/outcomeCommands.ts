import type { TopicClusteringOutcomeCommands } from "../../topicClusteringIntentHandlers";

/**
 * A full {@link TopicClusteringOutcomeCommands} whose every member throws.
 *
 * For the harnesses that never dispatch an intent. It is deliberately total:
 * a partial double lets the run handler's best-effort try/catch swallow a
 * `TypeError` and quietly exercise the "announcement failed" path instead of
 * the one under test.
 */
export function outcomeCommandsThatMustNotRun(
  reason: string,
): TopicClusteringOutcomeCommands {
  const fail = (): never => {
    throw new Error(reason);
  };
  return {
    recordClusteringRunStarted: fail,
    recordClusteringRunCompleted: fail,
    recordClusteringRunFailed: fail,
  };
}
