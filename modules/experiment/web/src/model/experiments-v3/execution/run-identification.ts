/**
 * Answering a run action with the id of the run it started.
 */

/**
 * How long the action waits for the stream to name its run.
 */
export const RUN_ID_WAIT_MS = 30_000;

/**
 * Start a run and answer with its id.
 */
export function startAndIdentifyRun({
  start,
}: {
  start: (onRunStarted: (runId: string | undefined) => void) => Promise<void> | void;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (runId?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(runId);
    };
    const timer = setTimeout(() => answer(undefined), RUN_ID_WAIT_MS);
    const started = start(answer);
    if (started) {
      void started.finally(() => answer(undefined)).catch(() => undefined);
    }
  });
}
