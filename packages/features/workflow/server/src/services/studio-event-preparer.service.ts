import type { DatasetService } from "@langwatch/dataset-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type {
  WorkflowLlmParametersPort,
  WorkflowProjectEnvironmentPort,
} from "../ports/workflow.port";
import { materializeStudioDatasets } from "./studio-dataset-materializer.service";
import {
  StudioWorkflowEventEnricher,
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
    this.enricher = StudioWorkflowEventEnricher.create({
      projectEnvironment: options.projectEnvironment,
      llmParameters: options.llmParameters,
    });
  }

  private readonly enricher: StudioEventEnricher;

  enrich(input: StudioEventPreparationInput): Promise<StudioClientEvent> {
    return this.enricher.enrich(input);
  }

  async prepare(input: StudioEventPreparationInput): Promise<StudioClientEvent> {
    const event = await this.enrich(input);
    return materializeStudioDatasets({
      ...input,
      event,
      datasets: this.options.datasets,
    });
  }
}
