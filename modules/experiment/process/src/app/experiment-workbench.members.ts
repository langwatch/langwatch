// The two best-effort sinks the workbench reports through, beyond the experiment application.
// Live here so app can answer them.

/**
 * The two best-effort sinks a workbench run reports through. Neither is a
 * decision the run waits on: where this deployment records neither, the
 * member's own methods do nothing and the run is unaffected.
 */
export type ExperimentWorkbenchObserver = Readonly<{
  /** Records that a person ran an experiment. */
  recordExperimentRan(
    input: Readonly<{
      userId: string;
      projectId: string;
      experimentId: string | undefined;
      isFullRun: boolean;
    }>,
  ): void;
  /** Where an unnamed failure is reported. */
  reportError(error: unknown, context: Readonly<Record<string, unknown>>): void;
}>;
