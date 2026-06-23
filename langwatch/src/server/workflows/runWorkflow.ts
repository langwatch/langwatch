import type { Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { addEnvs } from "../../optimization_studio/server/addEnvs";
import type {
  ExecutionStatus,
  Workflow,
} from "../../optimization_studio/types/dsl";
import type { StudioClientEvent } from "../../optimization_studio/types/events";
import { getEntryInputs } from "../../optimization_studio/utils/nodeUtils";
import { nlpgoFetch, type NLPOrigin } from "../nlpgo/nlpgoFetch";
import { getProjectModelProviders } from "../api/routers/modelProviders.utils";
import { prisma } from "../db";
import type { SingleEvaluationResult } from "../evaluations/evaluators";
import type { MaybeStoredModelProvider } from "../modelProviders/registry";
import { createLogger } from "../../utils/logger";
import { stripUnsupportedLLMParamsFromWorkflow } from "./stripUnsupportedLLMParams";

const logger = createLogger("langwatch:workflows:runWorkflow");

const getWorkFlow = (state: Workflow) => {
  return {
    workflow_id: state.workflow_id,
    spec_version: state.spec_version,
    name: state.name,
    icon: state.icon,
    description: state.description,
    version: state.version,
    default_llm: state.default_llm,
    enable_tracing: state.enable_tracing,
    nodes: state.nodes,
    edges: state.edges,
    state: state.state,
    template_adapter: state.template_adapter,
    workflow_type: state.workflow_type,
  };
};

const checkForRequiredInputs = (
  publishedWorkflowVersion: Workflow,
  body: Record<string, unknown>,
) => {
  const bodyInputs = Object.keys(body);

  const entryInputs = getEntryInputs(
    publishedWorkflowVersion?.edges,
    publishedWorkflowVersion?.nodes,
  );

  const requiredInputs: string[] = [];
  entryInputs
    .filter((input) => !input.optional)
    .map((input) => {
      requiredInputs.push(input.sourceHandle?.split(".")[1] ?? "");
    });

  requiredInputs.forEach((input) => {
    if (!bodyInputs.includes(input)) {
      throw new Error(`Missing required input: ${input}`);
    }
  });
  return true;
};

const checkForRequiredLLMKeys = (
  publishedWorkflowVersion: Workflow,
  projectLLMKeys: MaybeStoredModelProvider[],
) => {
  const llmModelsNeeded: string[] = [];
  const projectLLKeysNotSet: string[] = [];

  const projectLLMKeysArray = Object.values(projectLLMKeys);

  projectLLMKeysArray.forEach((LLMConfig) => {
    if (!LLMConfig.customKeys) {
      projectLLKeysNotSet.push(LLMConfig.provider);
    }
  });

  publishedWorkflowVersion.nodes.forEach((node: Node) => {
    if (
      node.type === "signature" &&
      node.data &&
      typeof node.data === "object" &&
      "llm" in node.data
    ) {
      const llmData = node.data.llm as { model?: string };
      if (llmData.model) {
        const modelName = llmData.model.split("/")[0];
        if (modelName) {
          llmModelsNeeded.push(modelName);
        }
      }
    }
  });

  const missingKey = projectLLKeysNotSet.find((key) =>
    llmModelsNeeded.includes(key),
  );
  if (missingKey) {
    throw new Error(
      `Missing required LLM key: ${missingKey}. Please set the LLM key in the project settings`,
    );
  }
  return true;
};

export async function runEvaluationWorkflow(
  workflowId: string,
  projectId: string,
  inputs: Record<string, string>,
  versionId?: string,
  causalityDepth?: number,
  parentTrace?: { traceId: string; parentSpanId: string },
): Promise<{
  result: SingleEvaluationResult;
  status: ExecutionStatus;
}> {
  try {
    const data = await runWorkflow(
      workflowId,
      projectId,
      inputs,
      versionId,
      // do_not_trace=false: we WANT the evaluator's spans to land on
      // the parent trace so they show in Studio's waterfall as a
      // child sub-tree. This was historically `true` to avoid an
      // eval-of-eval loop (pre-2026-05-11 fix), but loop prevention
      // now lives in the depth-attribute reactor — the do_not_trace
      // path is now actively harmful: it skips parent-context setup
      // in nlpgo's startStudioSpan so eval child spans (LLM calls,
      // execute_component) get a fresh trace_id and land as a
      // separate orphan trace. See the 2026-05-14 prod regression
      // reported by rchaves.
      false, // do_not_trace
      false, // run_evaluations - disable evaluators inside the workflow when running as an online evaluation
      "evaluation",
      // Always pass a concrete depth (default 0) so the downstream
      // header gate in nlpgoFetch sees this as an evaluator-chain call
      // even when the parent had no depth attribute yet.
      causalityDepth ?? 0,
      parentTrace,
    );

    // Process the result
    if (data.result) {
      if ("score" in data.result && typeof data.result.score === "boolean") {
        // Boolean scores (true/false) are coerced to 1/0 to match the numeric score field
        data.result.score = data.result.score ? 1 : 0;
      } else if (
        "score" in data.result &&
        (typeof data.result.score === "number" ||
          typeof data.result.score === "string")
      ) {
        const parsedScore = parseFloat(data.result.score + "");
        data.result.score = isNaN(parsedScore) ? 0 : parsedScore;
      }
      if (
        "passed" in data.result &&
        (typeof data.result.passed === "boolean" ||
          typeof data.result.passed === "string")
      ) {
        data.result.passed =
          data.result.passed === true || data.result.passed + "" === "true";
      }
    }

    return data;
  } catch (error) {
    return {
      status: "error",
      result: {
        status: "error",
        details: (error as Error).message,
        error_type: "WORKFLOW_ERROR",
        traceback: [(error as Error).stack ?? ""],
      },
    };
  }
}

export async function runWorkflow(
  workflowId: string,
  projectId: string,
  inputs: Record<string, string>,
  versionId?: string,
  do_not_trace?: boolean,
  run_evaluations?: boolean,
  origin: NLPOrigin = "workflow",
  causalityDepth?: number,
  parentTrace?: { traceId: string; parentSpanId: string },
) {
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId, projectId },
  });

  if (!workflow) {
    throw new Error("Workflow not found.");
  }
  if (!workflow.publishedId) {
    throw new Error("Workflow not published");
  }

  const publishedWorkflowVersion = await prisma.workflowVersion.findUnique({
    where: {
      id: versionId ?? workflow.publishedId,
      projectId,
    },
  });

  if (!publishedWorkflowVersion) {
    throw new Error("Published workflow version not found.");
  }

  const workflowData = publishedWorkflowVersion.dsl as unknown as Workflow;
  const modelProviders = await getProjectModelProviders(projectId);

  // Validate inputs and LLM keys
  checkForRequiredInputs(workflowData, inputs);
  checkForRequiredLLMKeys(
    workflowData,
    modelProviders as unknown as MaybeStoredModelProvider[],
  );

  const trace_id = inputs.trace_id ?? `trace_${nanoid()}`;
  const messageWithoutEnvs: StudioClientEvent = {
    type: "execute_flow",
    payload: {
      trace_id,
      workflow: getWorkFlow(workflowData),
      inputs: [inputs],
      manual_execution_mode: false,
      do_not_trace:
        typeof do_not_trace === "boolean"
          ? do_not_trace
          : typeof inputs.do_not_trace === "boolean"
            ? inputs.do_not_trace
            : false,
      ...(typeof run_evaluations === "boolean" && { run_evaluations }),
      origin,
    },
  };

  // Strip every sampling parameter from each LLM block that the resolved
  // model does not list as supported. The Studio path (POST
  // /api/workflows/post_event) already does this; this is the parallel
  // chokepoint for every server-driven dispatch (online evaluators,
  // evaluator-as-evaluator chains, scheduled runs). Without it, a
  // published workflow that carries a stale top_p from before the
  // operator disabled it on their custom-model config still ships the
  // field to the gateway, and Bedrock newer-Claude rejects the combo
  // with `temperature and top_p cannot both be specified`. Customer
  // dogfood 2026-05-31 surfaced exactly this path on
  // us.anthropic.claude-haiku-4-5-* as an online evaluator. Best-effort
  // so a registry-lookup miss never blocks the run.
  try {
    await stripUnsupportedLLMParamsFromWorkflow({
      prisma,
      projectId,
      workflow: messageWithoutEnvs.payload.workflow as Parameters<
        typeof stripUnsupportedLLMParamsFromWorkflow
      >[0]["workflow"],
    });
  } catch (filterError) {
    logger.warn(
      { err: filterError, projectId, workflowId },
      "stripUnsupportedLLMParamsFromWorkflow failed; forwarding original payload",
    );
  }

  const event = await addEnvs(messageWithoutEnvs, projectId);

  const response = await nlpgoFetch<{
    result: any;
    status: ExecutionStatus;
  }>({
    projectId,
    path: "/studio/execute_sync",
    body: event,
    origin,
    causalityDepth,
    parentTrace,
  });

  if (!response.ok) {
    throw new Error(`Error running workflow: ${response.statusText}`);
  }

  return await response.json();
}
