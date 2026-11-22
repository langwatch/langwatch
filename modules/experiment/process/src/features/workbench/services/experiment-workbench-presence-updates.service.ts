import type { Logger } from "@langwatch/observability";
import type { PresenceApi } from "@langwatch/presence-contract";

import { ExperimentWorkbenchUpdates } from "./experiment-workbench.service.ts";

/**
 * A workbench save's freshness notice, published on presence's tenant fabric. It carries no state:
 * every tab refetches. A failed publish is logged, never thrown, since the save is already durable.
 */
export class ExperimentWorkbenchPresenceUpdatesService extends ExperimentWorkbenchUpdates {
  private constructor(
    private readonly presence: Pick<PresenceApi, "publishProjectEvent">,
    private readonly logger: Pick<Logger, "warn">,
  ) {
    super();
  }

  static create(input: {
    presence: Pick<PresenceApi, "publishProjectEvent">;
    logger: Pick<Logger, "warn">;
  }): ExperimentWorkbenchPresenceUpdatesService {
    return new ExperimentWorkbenchPresenceUpdatesService(input.presence, input.logger);
  }

  async publish(input: Parameters<ExperimentWorkbenchUpdates["publish"]>[0]): Promise<void> {
    const { projectId, experimentId, slug, version, actorLabel, runId } = input;
    try {
      await this.presence.publishProjectEvent({
        projectId,
        channel: "experiment_updated",
        event: JSON.stringify({
          event: "experiment_updated",
          experimentId,
          slug,
          version,
          actorLabel,
          ...(runId ? { runId } : {}),
        }),
      });
    } catch (error) {
      this.logger.warn(
        { projectId, experimentId, version, error },
        "Failed to broadcast experiment update",
      );
    }
  }
}
