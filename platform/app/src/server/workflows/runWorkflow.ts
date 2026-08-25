import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type {
  WorkflowDsl,
  WorkflowService,
} from "@langwatch/workflow-contract";
import type { WorkflowExecutionPort } from "@langwatch/workflow-server";
import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { z } from "zod";
import type {
  ExecutionStatus,
  StudioWorkflow,
} from "@langwatch/workflow-contract";
import type { StudioClientEvent } from "../../optimization_studio/types/events";
import { migrateDSLVersion } from "@langwatch/workflow-contract";
import { getEntryInputs } from "@langwatch/workflow-contract";
import {
  singleEvaluationResultSchema,
  type SingleEvaluationResult,
} from "../evaluations/evaluators";
import type { NLPOrigin } from "../nlpgo/nlpgoFetch";
import { WorkflowExecutionFailedError } from "./errors";

const logger = createLogger("langwatch:workflows:execution");

type WorkflowExecutionInput = Parameters<WorkflowExecutionPort["execute"]>[0];

const workflowExecutionResponseSchema = z.object({
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(["idle", "waiting", "running", "success", "error", "skipped"]),
});

type WorkflowExecutionResponse = z.infer<typeof workflowExecutionResponseSchema>;

/**
 * App-owned infrastructure required to turn a resolved Workflow version into
 * an nlpgo request. These capabilities are process-composed, never globals
 * consulted by the execution implementation.
 */
export type WorkflowExecutionRuntime = {
  migrateDsl(dsl: WorkflowDsl): StudioWorkflow;
  getProjectModelProviders(
    projectId: string,
  ): Promise<
    Record<
      string,
      { provider: string; customKeys: Record<string, unknown> | null }
    >
  >;
  stripUnsupportedParams(input: {
    projectId: string;
    workflow: StudioWorkflow;
  }): Promise<void>;
  addEnvs(event: StudioClientEvent, projectId: string): Promise<StudioClientEvent>;
  dispatchNlp(input: {
    projectId: string;
    body: StudioClientEvent;
    origin: NLPOrigin;
    causalityDepth?: number;
    parentTrace?: { traceId: string; parentSpanId: string };
  }): Promise<{
    ok: boolean;
    status: number;
    statusText: string;
    json(): Promise<unknown>;
  }>;
  createTraceId(): string;
};

const getWorkflowPayload = (state: StudioWorkflow) => ({
  workflow_id: state.workflow_id,
  spec_version: state.spec_version,
  name: state.name,
  icon: state.icon,
  description: state.description,
  version: state.version,
  enable_tracing: state.enable_tracing,
  nodes: state.nodes,
  edges: state.edges,
  state: state.state,
  template_adapter: state.template_adapter,
  workflow_type: state.workflow_type,
});

const assertRequiredInputs = (
  workflow: StudioWorkflow,
  inputs: Record<string, unknown>,
): void => {
  const inputNames = new Set(Object.keys(inputs));
  const entryInputs = getEntryInputs(workflow.edges, workflow.nodes);

  for (const entry of entryInputs) {
    if (entry.optional) continue;
    const name = entry.sourceHandle?.split(".")[1];
    if (!name || inputNames.has(name)) continue;
    throw new ValidationError(`Missing required input: ${name}`, {
      meta: { input: name },
    });
  }
};

const assertRequiredModelKeys = (
  workflow: StudioWorkflow,
  providers: Record<
    string,
    { provider: string; customKeys: Record<string, unknown> | null }
  >,
): void => {
  const modelsNeeded = workflow.nodes.flatMap((node: Node) => {
    if (
      node.type !== "signature" ||
      !node.data ||
      typeof node.data !== "object" ||
      !("llm" in node.data)
    ) {
      return [];
    }
    const llm = node.data.llm;
    if (!llm || typeof llm !== "object" || !("model" in llm)) return [];
    const model = llm.model;
    if (typeof model !== "string") return [];
    const provider = model.split("/")[0];
    return provider ? [provider] : [];
  });
  const missingProvider = Object.values(providers).find(
    (provider) => !provider.customKeys && modelsNeeded.includes(provider.provider),
  );
  if (!missingProvider) return;

  throw new ValidationError(
    `Missing required LLM key: ${missingProvider.provider}. Please set the LLM key in the project settings`,
    { meta: { missingKey: missingProvider.provider } },
  );
};

/**
 * Executes a version the canonical Workflow service already resolved. It has
 * no database dependency and never selects a workflow version itself.
 */
export class WorkflowNlpExecutor {
  static create(runtime: WorkflowExecutionRuntime): WorkflowNlpExecutor {
    return new WorkflowNlpExecutor(runtime);
  }

  private constructor(private readonly runtime: WorkflowExecutionRuntime) {}

  async execute(input: WorkflowExecutionInput): Promise<WorkflowExecutionResponse> {
    const workflow = this.runtime.migrateDsl(input.version.dsl);
    const providers = await this.runtime.getProjectModelProviders(input.projectId);
    assertRequiredInputs(workflow, input.inputs);
    assertRequiredModelKeys(workflow, providers);

    const traceId =
      typeof input.inputs.trace_id === "string"
        ? input.inputs.trace_id
        : this.runtime.createTraceId();
    const origin = input.origin ?? "workflow";
    const event: StudioClientEvent = {
      type: "execute_flow",
      payload: {
        trace_id: traceId,
        workflow: getWorkflowPayload(workflow),
        inputs: [input.inputs],
        manual_execution_mode: false,
        do_not_trace:
          input.doNotTrace ??
          (typeof input.inputs.do_not_trace === "boolean"
            ? input.inputs.do_not_trace
            : false),
        ...(input.runEvaluations === undefined
          ? {}
          : { run_evaluations: input.runEvaluations }),
        origin,
      },
    };

    try {
      await this.runtime.stripUnsupportedParams({
        projectId: input.projectId,
        workflow: event.payload.workflow,
      });
    } catch (error) {
      logger.warn(
        { err: error, projectId: input.projectId, workflowId: input.workflowId },
        "stripUnsupportedLLMParamsFromWorkflow failed; forwarding original payload",
      );
    }

    const response = await this.runtime.dispatchNlp({
      projectId: input.projectId,
      body: await this.runtime.addEnvs(event, input.projectId),
      origin,
      causalityDepth: input.causalityDepth,
      parentTrace: input.parentTrace,
    });
    if (!response.ok) {
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          projectId: input.projectId,
          workflowId: input.workflowId,
        },
        "nlpgo execute_sync returned a non-OK response",
      );
      throw new WorkflowExecutionFailedError();
    }
    return workflowExecutionResponseSchema.parse(await response.json());
  }
}

/**
 * App-side bridge for Evaluation. It depends on the canonical Workflow
 * service, so evaluation never reaches around it to resolve a version.
 */
export class WorkflowEvaluationRunner {
  static create(workflows: WorkflowService): WorkflowEvaluationRunner {
    return new WorkflowEvaluationRunner(workflows);
  }

  private constructor(private readonly workflows: WorkflowService) {}

  async runEvaluationWorkflow(
    workflowId: string,
    projectId: string,
    inputs: Record<string, unknown>,
    versionId?: string,
    causalityDepth?: number,
    parentTrace?: { traceId: string; parentSpanId: string },
  ): Promise<{ result: SingleEvaluationResult; status: ExecutionStatus }> {
    return WorkflowEvaluationRunner.run(
      this.workflows,
      workflowId,
      projectId,
      inputs,
      versionId,
      causalityDepth,
      parentTrace,
    );
  }

  static async run(
    workflows: WorkflowService,
    workflowId: string,
    projectId: string,
    inputs: Record<string, unknown>,
    versionId?: string,
    causalityDepth?: number,
    parentTrace?: { traceId: string; parentSpanId: string },
  ): Promise<{ result: SingleEvaluationResult; status: ExecutionStatus }> {
    try {
      const response = await workflows.run({
        workflowId,
        projectId,
        inputs,
        versionId,
        doNotTrace: false,
        runEvaluations: false,
        origin: "evaluation",
        causalityDepth: causalityDepth ?? 0,
        parentTrace,
      });
      return normalizeEvaluationResponse(response);
    } catch (error) {
      return {
        status: "error",
        result: singleEvaluationResultSchema.parse({
          status: "error",
          details: error instanceof Error ? error.message : "Workflow execution failed",
          error_type: "WORKFLOW_ERROR",
          traceback: [error instanceof Error ? (error.stack ?? "") : ""],
        }),
      };
    }
  }
}

function normalizeEvaluationResponse(
  value: unknown,
): { result: SingleEvaluationResult; status: ExecutionStatus } {
  const response = workflowExecutionResponseSchema.parse(value);
  if (!response.result) {
    throw new Error("Workflow execution returned an invalid result.");
  }
  const score = response.result.score;
  const passed = response.result.passed;
  const normalized = {
    ...response.result,
    ...(typeof score === "number" || typeof score === "string"
      ? { score: Number.parseFloat(String(score)) || 0 }
      : {}),
    ...(typeof passed === "boolean" || typeof passed === "string"
      ? { passed: passed === true || passed === "true" }
      : {}),
  };
  if (response.status === "success") {
    return {
      status: response.status,
      result: singleEvaluationResultSchema.parse({
        ...normalized,
        status: "processed",
      }),
    };
  }
  return {
    status: response.status,
    result: singleEvaluationResultSchema.parse({
      status: "error",
      details:
        typeof normalized.details === "string"
          ? normalized.details
          : "Workflow execution failed",
      error_type:
        typeof normalized.error_type === "string"
          ? normalized.error_type
          : "WORKFLOW_ERROR",
      traceback: Array.isArray(normalized.traceback)
        ? normalized.traceback.filter((entry): entry is string => typeof entry === "string")
        : [],
    }),
  };
}

/** Explicit default for composition roots that do not supply a trace factory. */
export function createWorkflowTraceId(): string {
  return `trace_${nanoid()}`;
}

/**
 * The Studio migration module owns the legacy graph upgrades. Its public
 * input is the portable Workflow schema because persisted versions may predate
 * the Studio-only `Workflow` TypeScript shape.
 */
export function migrateWorkflowDslForExecution(dsl: WorkflowDsl): StudioWorkflow {
  return migrateDSLVersion(dsl);
}
