import type { WorkbenchActorLabel } from "@langwatch/experiment-contract";

export abstract class ExperimentWorkbenchUpdates {
  abstract publish(input: {
    projectId: string;
    experimentId: string;
    slug: string;
    version: number;
    actorLabel: WorkbenchActorLabel;
    runId?: string;
  }): Promise<void>;
}
