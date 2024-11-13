import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../server/api/routers/modelProviders";
import { prisma } from "../../server/db";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import type { LLMConfig, ServerWorkflow } from "../types/dsl";
import type { StudioClientEvent } from "../types/events";

export const addEnvs = async (
  event: StudioClientEvent,
  projectId: string
): Promise<StudioClientEvent> => {
  if (!("workflow" in event.payload)) {
    return event;
  }

  const [modelProviders, { apiKey }] = await Promise.all([
    getProjectModelProviders(projectId),
    prisma.project.findUniqueOrThrow({
      where: {
        id: projectId,
      },
      select: {
        apiKey: true,
      },
    }),
  ]);

  const workflow_id = event.payload.workflow.workflow_id;
  if (!workflow_id) {
    throw new Error("Workflow ID is required");
  }

  const default_llm = addLiteLLMParams(
    event.payload.workflow.default_llm,
    modelProviders
  );

  const workflow: ServerWorkflow = {
    ...event.payload.workflow,
    workflow_id,
    api_key: apiKey,
    default_llm: default_llm,
    nodes: event.payload.workflow.nodes.map((node) => {
      const parameters = node.data.parameters?.map((p) => {
        if (p.type === "llm") {
          return {
            ...p,
            value: p.value
              ? addLiteLLMParams(p.value as LLMConfig, modelProviders)
              : default_llm,
          };
        }
        return p;
      });

      return { ...node, data: { ...node.data, parameters } };
    }),
  };

  return {
    ...event,
    payload: {
      ...event.payload,
      workflow,
    } as any,
  };
};

const addLiteLLMParams = (
  llm: LLMConfig,
  modelProviders: Record<string, MaybeStoredModelProvider>
) => {
  const provider = llm.model.split("/")[0]!;
  const modelProvider = modelProviders[provider];
  if (!modelProvider) {
    throw new Error(`Model provider not configured: ${provider}`);
  }
  if (!modelProvider.enabled) {
    throw new Error(
      `${provider} model provider is disabled, go to settings to enable it`
    );
  }

  return {
    ...llm,
    litellm_params: prepareLitellmParams(llm.model, modelProvider),
  };
};
