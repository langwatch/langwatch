import type { Logger } from "@langwatch/observability";

/** One run that ended, as the workbench reports it. */
export type ExperimentRan = Readonly<{
  userId: string;
  projectId: string;
  experimentId: string | undefined;
  isFullRun: boolean;
}>;

/**
 * The two best-effort sinks a workbench run reports through. Neither is a
 * decision the run waits on: where this deployment records neither, the
 * member's own methods do nothing and the run is unaffected.
 */
export type ExperimentWorkbenchObserver = Readonly<{
  /** Records that a person ran an experiment. */
  recordExperimentRan(input: ExperimentRan): void;
  /** Where an unnamed failure is reported. */
  reportError(error: unknown, context: Readonly<Record<string, unknown>>): void;
}>;

/** Announces one run that ended to the lifecycle pipeline; a failure is the caller's to log. */
export type ExperimentRanAnnouncer = (input: ExperimentRan) => Promise<void>;

/** Where an ended run is announced and an unnamed workbench failure reported. Both best-effort. */
export class ExperimentWorkbenchObserverService implements ExperimentWorkbenchObserver {
  static create(input: {
    logger: Pick<Logger, "error">;
    announce: ExperimentRanAnnouncer;
  }): ExperimentWorkbenchObserverService {
    return new ExperimentWorkbenchObserverService(input.logger, input.announce);
  }

  private constructor(
    private readonly logger: Pick<Logger, "error">,
    private readonly announce: ExperimentRanAnnouncer,
  ) {}

  recordExperimentRan(ran: ExperimentRan): void {
    void this.announce(ran).catch((error: unknown) =>
      this.logger.error(
        { error, projectId: ran.projectId },
        "the experiment ran event was not recorded",
      ),
    );
  }

  reportError(error: unknown, context: Readonly<Record<string, unknown>>): void {
    this.logger.error({ error, ...context }, "an unnamed workbench failure");
  }
}
