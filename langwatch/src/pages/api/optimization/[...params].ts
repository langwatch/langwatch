import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db"; // Adjust the import based on your setup
import { getProjectModelProviders } from "~/server/api/routers/modelProviders";
import { type Workflow } from "~/optimization_studio/types/dsl";
import { nanoid } from "nanoid";

import type { StudioClientEvent } from "~/optimization_studio/types/events";

import { type Edge, type Node } from "@xyflow/react";
import { type MaybeStoredModelProvider } from "~/server/modelProviders/registry";
import { addEnvs } from "~/optimization_studio/server/addEnvs";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const xAuthToken = req.headers["x-auth-token"];
  const authHeader = req.headers.authorization;

  const { params } = req.query;

  const [workflowId, versionId] = params as [string, string];

  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return res.status(401).json({
      message:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    });
  }

  if (
    req.headers["content-type"] !== "application/json" ||
    typeof req.body !== "object"
  ) {
    return res.status(400).json({ message: "Invalid body, expecting json" });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
    include: {
      team: true,
    },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId, projectId: project.id },
  });

  if (!workflow) {
    return res.status(404).json({ message: "Workflow not found." });
  }
  if (!workflow.publishedId) {
    return res.status(404).json({ message: "Workflow not published" });
  }

  const body = req.body;

  const publishedWorkflowVersion = await prisma.workflowVersion.findUnique({
    where: {
      id: versionId ?? workflow.publishedId,
      projectId: project.id,
    },
  });

  if (!publishedWorkflowVersion) {
    return res
      .status(404)
      .json({ message: "Published workflow version not found." });
  }

  const workflowData = publishedWorkflowVersion.dsl as unknown as Workflow;

  checkForRequiredInputs(workflowData, body, res);

  const modelProviders = await getProjectModelProviders(project.id);

  checkForRequiredLLMKeys(
    workflowData,
    modelProviders as unknown as MaybeStoredModelProvider[],
    res
  );

  const trace_id = `trace_${nanoid()}`;

  const getWorkFlow = (state: Workflow) => {
    return {
      workflow_id: state.workflow_id,
      spec_version: state.spec_version,
      name: state.name,
      icon: state.icon,
      description: state.description,
      version: state.version,
      default_llm: state.default_llm,
      nodes: state.nodes,
      edges: state.edges,
      state: state.state,
    };
  };

  const messageWithoutEnvs: StudioClientEvent = {
    type: "execute_flow",
    payload: {
      trace_id,
      workflow: getWorkFlow(workflowData),
      inputs: [body],
      manual_execution_mode: false,
    },
  };

  const event = await addEnvs(messageWithoutEnvs, project.id);

  try {
    const response = await fetch(
      `${process.env.LANGWATCH_NLP_SERVICE}/studio/execute_sync`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ message: data.detail });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ message: error });
  }
}

const checkForRequiredInputs = (
  publishedWorkflowVersion: Workflow,
  body: Record<string, string>,
  res: NextApiResponse
) => {
  const bodyInputs = Object.keys(body);

  const entryEdges = publishedWorkflowVersion?.edges.filter(
    (edge: Edge) => edge.source === "entry"
  );
  const evaluators = publishedWorkflowVersion?.nodes.filter(
    (node: Node) => node.type === "evaluator"
  );

  const entryInputs = entryEdges.filter(
    (edge: Edge) =>
      !evaluators?.some((evaluator: Node) => evaluator.id === edge.target)
  );

  const requiredInputs: string[] = [];
  entryInputs.map((input) => {
    requiredInputs.push(input.sourceHandle?.split(".")[1] ?? "");
  });

  requiredInputs.forEach((input) => {
    if (!bodyInputs.includes(input)) {
      return res
        .status(400)
        .json({ message: `Missing required input: ${input}` });
    }
  });
  return true;
};

const checkForRequiredLLMKeys = (
  publishedWorkflowVersion: Workflow,
  projectLLMKeys: MaybeStoredModelProvider[],
  res: NextApiResponse
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
    return res.status(400).json({
      message: `Missing required LLM key: ${missingKey}. Please set the LLM key in the project settings`,
    });
  }
  return true;
};
