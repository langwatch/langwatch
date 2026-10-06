import type { EventingCommands } from "@langwatch/eventing";
import type { Logger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import type { ExperimentLifecyclePipeline } from "../eventing/experiment-lifecycle.pipeline.ts";

/** One run that ended, as the workbench reports it. */
type ExperimentRan = Readonly<{
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
type ExperimentRanAnnouncer = (input: ExperimentRan) => Promise<void>;

/** Where an ended run is announced and an unnamed workbench failure reported. Both best-effort. */
export class ExperimentWorkbenchObserverService implements ExperimentWorkbenchObserver {
  static create(input: {
    logger: Pick<Logger, "error">;
    senders: { commands?: EventingCommands<ExperimentLifecyclePipeline> };
  }): ExperimentWorkbenchObserverService {
    const { senders } = input;
    return new ExperimentWorkbenchObserverService(input.logger, async (ran) => {
      if (!senders.commands) {
        throw new Error("experiment_lifecycle pipeline senders are not connected yet");
      }
      await senders.commands.recordExperimentRan.send({
        tenantId: ran.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        userId: ran.userId,
        projectId: ran.projectId,
        experimentId: ran.experimentId ?? null,
        fullRun: ran.isFullRun,
      });
    });
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
