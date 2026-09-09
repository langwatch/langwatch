import type { DatasetApi } from "@langwatch/dataset-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type {
  WorkflowLlmParametersPort,
  WorkflowProjectEnvironmentPort,
} from "../ports/workflow.port.ts";
import { StudioDatasetMaterializerService } from "./studio-dataset-materializer.service.ts";
import {
  StudioWorkflowEventEnricherService,
  type StudioEventEnricher,
} from "./studio-workflow-event-enricher.service.ts";

export type StudioEventPreparationInput = {
  event: StudioClientEvent;
  projectId: string;
};

export type StudioEventPreparer = {
  enrich(input: StudioEventPreparationInput): Promise<StudioClientEvent>;
  prepare(input: StudioEventPreparationInput): Promise<StudioClientEvent>;
};

type StudioEventPreparerOptions = {
  datasets: DatasetApi;
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
};

export class StudioEventPreparerService implements StudioEventPreparer {
  static create(options: StudioEventPreparerOptions): StudioEventPreparerService {
    return new StudioEventPreparerService(options);
  }

  private constructor(options: StudioEventPreparerOptions) {
    this.enricher = StudioWorkflowEventEnricherService.create({
      projectEnvironment: options.projectEnvironment,
      llmParameters: options.llmParameters,
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
