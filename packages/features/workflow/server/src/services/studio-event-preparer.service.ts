import type { DatasetService } from "@langwatch/dataset-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type {
  WorkflowLlmParametersPort,
  WorkflowProjectEnvironmentPort,
} from "../ports/workflow.port";
import { StudioDatasetMaterializerService } from "./studio-dataset-materializer.service";
import {
  StudioWorkflowEventEnricherService,
  type StudioEventEnricher,
} from "./studio-workflow-event-enricher.service";

export type StudioEventPreparationInput = {
  event: StudioClientEvent;
  projectId: string;
};

export type StudioEventPreparer = {
  enrich(input: StudioEventPreparationInput): Promise<StudioClientEvent>;
  prepare(input: StudioEventPreparationInput): Promise<StudioClientEvent>;
};

type StudioEventPreparerOptions = {
  datasets: DatasetService;
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
};

export class StudioEventPreparerService implements StudioEventPreparer {
  static create(options: StudioEventPreparerOptions): StudioEventPreparerService {
    return new StudioEventPreparerService(options);
  }

  private constructor(private readonly options: StudioEventPreparerOptions) {
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
