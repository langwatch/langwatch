import { type Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { addEnvs } from "../../optimization_studio/server/addEnvs";
import {
  type ExecutionStatus,
  type Workflow,
} from "../../optimization_studio/types/dsl";
import type { StudioClientEvent } from "../../optimization_studio/types/events";
import { getEntryInputs } from "../../optimization_studio/utils/nodeUtils";
import { lambdaFetch } from "../../utils/lambdaFetch";
import { getProjectModelProviders } from "../api/routers/modelProviders";
import { prisma } from "../db";
import type { SingleEvaluationResult } from "../evaluations/evaluators.generated";
import { type MaybeStoredModelProvider } from "../modelProviders/registry";
import { getProjectLambdaArn } from "../../optimization_studio/server/lambda";

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
  body: Record<string, unknown>
) => {
  const bodyInputs = Object.keys(body);

  const entryInputs = getEntryInputs(
    publishedWorkflowVersion?.edges,
    publishedWorkflowVersion?.nodes
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
  projectLLMKeys: MaybeStoredModelProvider[]
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
    llmModelsNeeded.includes(key)
  );
  if (missingKey) {
    throw new Error(
      `Missing required LLM key: ${missingKey}. Please set the LLM key in the project settings`
    );
  }
  return true;
};

export async function runEvaluationWorkflow(
  workflowId: string,
  projectId: string,
  inputs: Record<string, string>,
  versionId?: string
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
      true
    );

    // Process the result
    if (data.result) {
      if (
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
  do_not_trace?: boolean
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
    modelProviders as unknown as MaybeStoredModelProvider[]
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
    },
  };

  const event = await addEnvs(messageWithoutEnvs, projectId);
  const functionArn = process.env.LANGWATCH_NLP_LAMBDA_CONFIG
    ? await getProjectLambdaArn(projectId)
    : process.env.LANGWATCH_NLP_SERVICE!;

  const response = await lambdaFetch<{
    result: any;
    status: ExecutionStatus;
  }>(functionArn, "/studio/execute_sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    throw new Error(`Error running workflow: ${response.statusText}`);
  }

  return await response.json();
}
