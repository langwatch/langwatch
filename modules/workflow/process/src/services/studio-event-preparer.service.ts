import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { StudioClientEvent, WorkflowRunPrincipal } from "@langwatch/workflow-contract";

import type { WorkflowLlmParameters, WorkflowProjectEnvironment } from "../app/workflow.app.ts";
import { StudioDatasetMaterializerService } from "./studio-dataset-materializer.service.ts";
import {
  StudioWorkflowEventEnricherService,
  type StudioEventEnricher,
} from "./studio-workflow-event-enricher.service.ts";

export type StudioEventPreparationInput = {
  event: StudioClientEvent;
  projectId: string;
  principal?: WorkflowRunPrincipal | undefined;
};

export type StudioEventPreparer = {
  enrich(input: StudioEventPreparationInput): Promise<StudioClientEvent>;
  prepare(input: StudioEventPreparationInput): Promise<StudioClientEvent>;
};

type StudioEventPreparerOptions = {
  datasets: DatasetApi;
  projectEnvironment: WorkflowProjectEnvironment;
  llmParameters: WorkflowLlmParameters;
  runKeys: Pick<ApiKeyApi, "mintRunKey">;
  dispatchKeyFloorMs: number;
};

export class StudioEventPreparerService implements StudioEventPreparer {
  static create(options: StudioEventPreparerOptions): StudioEventPreparerService {
    return new StudioEventPreparerService(options);
  }

  private constructor(options: StudioEventPreparerOptions) {
    this.enricher = StudioWorkflowEventEnricherService.create({
      projectEnvironment: options.projectEnvironment,
      llmParameters: options.llmParameters,
      runKeys: options.runKeys,
      dispatchKeyFloorMs: options.dispatchKeyFloorMs,
    });
    this.materializer = StudioDatasetMaterializerService.create(options.datasets);
  }

  private readonly enricher: StudioEventEnricher;
  private readonly materializer: StudioDatasetMaterializerService;

  enrich(input: StudioEventPreparationInput): Promise<StudioClientEvent> {
    return this.enricher.enrich(input);
  }

  async prepare(input: StudioEventPreparationInput): Promise<StudioClientEvent> {
    const event = await this.enrich(input);

    return this.materializer.materialize({
      event,
      projectId: input.projectId,
    });
  }
}
