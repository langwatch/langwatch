/** Why the CLI is ending: 0 for a requested stop, non-zero for a failed boot or a crash. */
export type ShutdownOutcome = { exitCode: number; reason?: string };

/**
 * Ends the CLI exactly once, whatever asks first (a signal, a failed boot, a
 * crash): announce, stop every service, let the last lines render, exit.
 */
export function createShutdown({
  announce,
  stopServices,
  flush,
  exit,
}: {
  announce: (outcome: ShutdownOutcome) => void;
  stopServices: () => Promise<void>;
  flush: () => Promise<void>;
  exit: (code: number) => void;
}): (outcome: ShutdownOutcome) => Promise<void> {
  let ending: Promise<void> | null = null;
  return (outcome) => {
    ending ??= (async () => {
      announce(outcome);
      await stopServices().catch(() => undefined);
      await flush().catch(() => undefined);
      exit(outcome.exitCode);
    })();
    return ending;
  };
}
