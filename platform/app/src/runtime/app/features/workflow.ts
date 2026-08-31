import type { DatasetService } from "@langwatch/dataset-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  PostgresWorkflowAdapter,
  WorkflowAgentMappingPort,
  WorkflowDslMigrationPort,
  WorkflowNlpRuntimePort,
  WorkflowRowPort,
  WorkflowStudioDslPort,
  type WorkflowLlmParametersPort,
  type WorkflowProjectEnvironmentPort,
  type WorkflowRowDraft,
} from "@langwatch/workflow-server";
import {
  mergeLocalConfigsIntoDsl,
  migrateDSLVersion,
  type StudioClientEvent,
  type StudioWorkflow,
  type WorkflowDsl,
  type WorkflowRunOrigin,
  type WorkflowService,
} from "@langwatch/workflow-contract";
import type { NlpLambdaRuntime } from "~/runtime/api/nlp-lambda";
import { nlpgoFetch } from "~/server/nlpgo/nlpgoFetch";
import { autoComputeAgentMappings } from "~/server/workflows/auto-compute-agent-mappings";
import { materializeNodeLlmConfigs } from "~/server/workflows/materializeNodeLlmConfigs";

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

/**
 * Studio graph preparation, as this deployment performs it: editor-only local
 * node configuration folded into the execution DSL, then every LLM node
 * without a model filled in from the project's model cascade.
 */
export class AppWorkflowStudioDslPort extends WorkflowStudioDslPort {
  static create(options: { modelProviders: ModelProviderService }): AppWorkflowStudioDslPort {
    return new AppWorkflowStudioDslPort(options);
  }

  private constructor(private readonly options: { modelProviders: ModelProviderService }) {
    super();
  }

  async prepare({
    projectId,
    dsl,
  }: {
    projectId: string;
    dsl: StudioWorkflow;
  }): Promise<StudioWorkflow> {
    // Cast required: the Studio schema types nodes loosely because the DSL node
    // types are too polymorphic for a single Zod discriminated union, while
    // mergeLocalConfigsIntoDsl works on the narrowed node union.
    const prepared = {
      ...dsl,
      nodes: mergeLocalConfigsIntoDsl(dsl.nodes as any) as any,
      state: {},
    };
    await materializeNodeLlmConfigs({
      projectId,
      dsl: prepared,
      modelProviders: this.options.modelProviders,
    });
    return prepared;
  }
}

/** The agent scenario mappings a saved Studio graph refreshes. */
export class AppWorkflowAgentMappingPort extends WorkflowAgentMappingPort {
  static create(options: { database: PrismaClient }): AppWorkflowAgentMappingPort {
    return new AppWorkflowAgentMappingPort(options);
  }

  private constructor(private readonly options: { database: PrismaClient }) {
    super();
  }

  recompute({
    projectId,
    workflowId,
    dsl,
  }: {
    projectId: string;
    workflowId: string;
    dsl: StudioWorkflow;
  }): Promise<void> {
    return autoComputeAgentMappings({
      prisma: this.options.database,
      workflowId,
      projectId,
      dsl,
    });
  }
}

/** The bare workflow row a Studio copy lands in. */
export class AppWorkflowRowPort extends WorkflowRowPort {
  static create(options: { database: PrismaClient }): AppWorkflowRowPort {
    return new AppWorkflowRowPort(options);
  }

  private constructor(private readonly options: { database: PrismaClient }) {
    super();
  }

  async create(input: WorkflowRowDraft): Promise<void> {
    await this.options.database.workflow.create({ data: input });
  }
}
