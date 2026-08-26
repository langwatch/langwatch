/**
 * Answering a run action with the id of the run it started.
 *
 * The workbench page and the scenario suites' fake tab both start a run and
 * both have to answer the caller with its id and nothing else: the run streams
 * for minutes and the dispatch clamps the action to 30 seconds, so a handler
 * that waited for the drain would turn every real run into a timeout. Shared
 * rather than mirrored, because the budget below is the same budget on both
 * sides and a second copy of it is what drifts.
 */

/**
 * How long the action waits for the stream to name its run.
 *
 * The id is minted server-side and travels on the first frame, so this only
 * has to cover opening the connection, which is the budget `fetchSSE` gives
 * that connection. The run itself is never waited for.
 */
export const RUN_ID_WAIT_MS = 30_000;

/**
 * Start a run and answer with its id.
 *
 * Answers with no id rather than holding the action open when the stream ends,
 * fails, or never opens: a run the caller cannot name is still a run that is
 * going, and the action's own budget is not the place to discover otherwise.
 *
 * `start` may return a promise, in which case its settling also answers: a run
 * whose stream ended without naming itself has nothing left to wait for. A
 * rejection is swallowed here, since the caller is being answered either way
 * and the run reports its own failure on the stream.
 */
export function startAndIdentifyRun({
  start,
}: {
  start: (
    onRunStarted: (runId: string | undefined) => void,
  ) => Promise<void> | void;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const answer = (runId?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(runId);
    };
    timer = setTimeout(() => answer(undefined), RUN_ID_WAIT_MS);
    const started = start(answer);
    if (started) {
      void started.finally(() => answer(undefined)).catch(() => undefined);
    }
  });
}
