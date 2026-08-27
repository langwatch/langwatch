import { createLogger } from "@langwatch/observability";
import { ExperimentWorkbenchUpdatesPort } from "@langwatch/experiment-server";
import type { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";

const logger = createLogger("langwatch:experiments");

export class AppExperimentWorkbenchUpdatesAdapter extends ExperimentWorkbenchUpdatesPort {
  static create(broadcast: BroadcastService): AppExperimentWorkbenchUpdatesAdapter {
    return new AppExperimentWorkbenchUpdatesAdapter(broadcast);
  }

  private constructor(private readonly broadcast: BroadcastService) {
    super();
  }

  async publish(input: {
    projectId: string;
    experimentId: string;
    slug: string;
    version: number;
    actorLabel: "user" | "langy" | "api";
    runId?: string;
  }): Promise<void> {
    try {
      await this.broadcast.broadcastToTenant(
        input.projectId,
        JSON.stringify({
          event: "experiment_updated",
          experimentId: input.experimentId,
          slug: input.slug,
          version: input.version,
          actorLabel: input.actorLabel,
          ...(input.runId ? { runId: input.runId } : {}),
        }),
        "experiment_updated",
      );
    } catch (error) {
      logger.warn({ ...input, error }, "Failed to broadcast experiment update");
    }
  }
}
