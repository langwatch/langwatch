/**
 * The workflow graph service over Postgres, under the name the worker
 * compositions still construct it by.
 *
 * A delegating factory only: the rows moved to `repositories/prisma`, and the
 * three services it binds are the module's own. This name goes once every
 * process reads its rows from the repository registry instead.
 */
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { nanoid } from "nanoid";
import { WorkflowIdPort } from "../ports/workflow.port.ts";
import type {
  WorkflowDslMigrationPort,
  WorkflowLlmParametersPort,
  WorkflowNlpRuntimePort,
  WorkflowProjectEnvironmentPort,
} from "../ports/workflow.port.ts";
import {
  PrismaWorkflowRepository,
  type WorkflowDatabase,
} from "../repositories/prisma/prisma.workflow.repository.ts";
import { StudioEventPreparerService } from "../services/studio-event-preparer.service.ts";
import { WorkflowNlpExecutionService } from "../services/workflow-nlp-execution.service.ts";
import { WorkflowService } from "../services/workflow.service.ts";

export type PostgresWorkflowAdapterOptions = {
  /** Generated Prisma client supplied by the application composition root. */
  database: WorkflowDatabase;
  datasets: DatasetApi;
  modelProviders: ModelProviderApi;
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

export class PostgresWorkflowAdapter {
  static create(options: PostgresWorkflowAdapterOptions): WorkflowService {
    const ids = NanoidWorkflowIdPort.create();
    const studioEvents = StudioEventPreparerService.create({
      datasets: options.datasets,
      projectEnvironment: options.projectEnvironment,
      llmParameters: options.llmParameters,
    });

    return WorkflowService.create({
      repository: PrismaWorkflowRepository.create({ database: options.database }),
      datasets: options.datasets,
      execution: WorkflowNlpExecutionService.create({
        ids,
        modelProviders: options.modelProviders,
        nlpRuntime: options.nlpRuntime,
        studioEvents,
      }),
      studioEvents,
      dslMigration: options.dslMigration,
      ids,
    });
  }
}
