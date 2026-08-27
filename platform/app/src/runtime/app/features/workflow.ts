import type { DatasetService } from "@langwatch/dataset-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PostgresWorkflowAdapter,
  WorkflowDslMigrationPort,
  WorkflowNlpRuntimePort,
  type WorkflowLlmParametersPort,
  type WorkflowProjectEnvironmentPort,
} from "@langwatch/workflow-server";
import {
  migrateDSLVersion,
  type StudioClientEvent,
  type WorkflowDsl,
  type WorkflowRunOrigin,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import type { NlpLambdaRuntime } from "~/runtime/api/nlp-lambda";
import { nlpgoFetch } from "~/server/nlpgo/nlpgoFetch";

/** App composition supplies one WorkflowService through request context. */
export type AppWorkflowRuntimeOptions = {
  database: PrismaClient;
  datasets: DatasetService;
  dslMigration?: WorkflowDslMigrationPort;
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
  modelProviders: ModelProviderService;
  nlpRuntime: WorkflowNlpRuntimePort;
};

export class AppWorkflowNlpRuntimePort extends WorkflowNlpRuntimePort {
  static create(nlpLambda: NlpLambdaRuntime): AppWorkflowNlpRuntimePort {
    return new AppWorkflowNlpRuntimePort(nlpLambda);
  }

  private constructor(private readonly nlpLambda: NlpLambdaRuntime) {
    super();
  }

  dispatch(input: {
    projectId: string;
    body: StudioClientEvent;
    origin: WorkflowRunOrigin;
    causalityDepth?: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }) {
    return nlpgoFetch(this.nlpLambda, {
      projectId: input.projectId,
      path: "/studio/execute_sync",
      body: input.body,
      origin: input.origin,
      causalityDepth: input.causalityDepth,
      parentTrace: input.parentTrace,
    });
  }
}

export class AppWorkflowDslMigrationPort extends WorkflowDslMigrationPort {
  static create(): AppWorkflowDslMigrationPort {
    return new AppWorkflowDslMigrationPort();
  }

  private constructor() {
    super();
  }

  migrate(dsl: WorkflowDsl): WorkflowDsl {
    return migrateDSLVersion(dsl);
  }
}

export class AppWorkflowRuntime {
  private constructor(private readonly options: AppWorkflowRuntimeOptions) {}

  static create(options: AppWorkflowRuntimeOptions): AppWorkflowRuntime {
    return new AppWorkflowRuntime(options);
  }

  build(): WorkflowService {
    return PostgresWorkflowAdapter.create({
      ...this.options,
      dslMigration: this.options.dslMigration ?? AppWorkflowDslMigrationPort.create(),
    });
  }
}
