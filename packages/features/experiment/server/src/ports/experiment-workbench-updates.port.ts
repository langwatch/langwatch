import type { WorkbenchActorLabel } from "@langwatch/experiment-contract";

export abstract class ExperimentWorkbenchUpdatesPort {
  abstract publish(input: {
    projectId: string;
    experimentId: string;
    slug: string;
    version: number;
    actorLabel: WorkbenchActorLabel;
    runId?: string;
  }): Promise<void>;
}
