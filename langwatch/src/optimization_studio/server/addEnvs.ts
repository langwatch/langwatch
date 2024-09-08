import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../server/api/routers/modelProviders";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import type { LLMConfig, Workflow } from "../types/dsl";
import type { StudioClientEvent } from "../types/events";

export const addEnvs = async (
  event: StudioClientEvent,
  projectId: string
): Promise<StudioClientEvent> => {
  if (!("workflow" in event.payload)) {
    return event;
  }

  const modelProviders = await getProjectModelProviders(projectId);

  const workflow: Workflow = {
    ...event.payload.workflow,
    default_llm: addLiteLLMParams(
      event.payload.workflow.default_llm,
      modelProviders
    ),
    nodes: event.payload.workflow.nodes.map((node) => {
      if ("llm" in node.data && node.data.llm) {
        return {
          ...node,
          data: {
            ...node.data,
            llm: addLiteLLMParams(node.data.llm, modelProviders),
          },
        };
      }
      return node;
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
      `Model provider is disabled: ${provider}, go to settings to enable it`
    );
  }

  return {
    ...llm,
    litellm_params: prepareLitellmParams(llm.model, modelProvider),
  };
};
