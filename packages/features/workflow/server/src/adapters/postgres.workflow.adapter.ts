import type { DatasetService } from "@langwatch/dataset-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { WorkflowService as WorkflowServiceContract } from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";
import { WorkflowIdPort } from "../ports/workflow.port";
import type {
  WorkflowDslMigrationPort,
  WorkflowLlmParametersPort,
  WorkflowNlpRuntimePort,
  WorkflowProjectEnvironmentPort,
} from "../ports/workflow.port";
import {
  PrismaWorkflowRepository,
  type WorkflowDatabase,
} from "../repositories/prisma/prisma-workflow.repository";
import { StudioEventPreparerService } from "../services/studio-event-preparer.service";
import { WorkflowNlpExecutionService } from "../services/workflow-nlp-execution.service";
import { WorkflowService } from "../services/workflow.service";

export type PostgresWorkflowAdapterOptions = {
  /** Generated Prisma client supplied by the application composition root. */
  database: WorkflowDatabase;
  datasets: DatasetService;
  modelProviders: ModelProviderService;
  nlpRuntime: WorkflowNlpRuntimePort;
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
  dslMigration: WorkflowDslMigrationPort;
};

class NanoidWorkflowIdPort extends WorkflowIdPort {
  static create(): NanoidWorkflowIdPort {
    return new NanoidWorkflowIdPort();
  }

  private constructor() {
    super();
  }

  next(): string {
    return nanoid();
  }
}

/** Binds the private Workflow repositories to one process-owned service. */
export class PostgresWorkflowAdapter {
  static create(options: PostgresWorkflowAdapterOptions): WorkflowServiceContract {
    const ids = NanoidWorkflowIdPort.create();
    const studioEvents = StudioEventPreparerService.create({
      datasets: options.datasets,
      projectEnvironment: options.projectEnvironment,
      llmParameters: options.llmParameters,
    });
    const execution = WorkflowNlpExecutionService.create({
      ids,
      modelProviders: options.modelProviders,
      nlpRuntime: options.nlpRuntime,
      studioEvents,
    });

    return WorkflowService.create({
      repository: PrismaWorkflowRepository.create(options.database),
      datasets: options.datasets,
      execution,
      studioEvents,
      dslMigration: options.dslMigration,
      ids,
    });
  }
}
