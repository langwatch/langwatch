/**
 * Ends a one-shot ingestion process itself: a post given up at its deadline
 * leaves its connect open for the system's ten seconds, holding the process.
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

/** The longest the process waits for stdout to drain before it ends anyway. */
const FLUSH_TIMEOUT_MS = 500;

/**
 * Run `work`, then end the process with exit code zero: once the work is done,
 * once it fails, or once `budgetMs` is spent, whichever comes first. A failure
 * is swallowed here, so no agent ever sees its hook fail.
 */
export async function endProcessWhenDone({
  work,
  budgetMs,
  exit = (code) => process.exit(code),
}: {
  work: () => Promise<void>;
  /** Omitted, the process waits for the work however long it takes. */
  budgetMs?: number;
  exit?: (code: number) => void;
}): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const budgetSpent = new Promise<void>((resolve) => {
    if (budgetMs !== undefined) timer = setTimeout(resolve, budgetMs);
  });
  try {
    await Promise.race([work(), budgetSpent]);
  } catch {
    // Failing the agent's hook is the one outcome this wrapper exists to prevent.
  } finally {
    clearTimeout(timer);
  }
  await flushStdout();
  exit(0);
}

/**
 * Wait for what was written to stdout to leave the process: ending it with a
 * pipe still holding buffered writes would cut them off. Bounded, so a reader
 * that stopped reading cannot keep the process up either.
 */
function flushStdout(): Promise<void> {
  if (process.stdout.writableLength === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
    process.stdout.write("", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
