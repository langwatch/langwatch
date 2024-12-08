import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../server/api/routers/modelProviders";
import { prisma } from "../../server/db";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import type { LLMConfig, ServerWorkflow } from "../types/dsl";
import type { StudioClientEvent } from "../types/events";
import crypto from "crypto";

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

  const onlyCustomKeys =
    event.type === "execute_optimization" ||
    event.type === "execute_evaluation";

  const getDefaultLLM = () => {
    if (!("workflow" in event.payload)) {
      throw new Error("Workflow is required");
    }
    return addLiteLLMParams(
      event.payload.workflow.default_llm,
      modelProviders,
      onlyCustomKeys
    );
  };

  const workflow: ServerWorkflow = {
    ...event.payload.workflow,
    workflow_id,
    api_key: apiKey,
    nodes: event.payload.workflow.nodes.map((node) => {
      const parameters = node.data.parameters?.map((p) => {
        if (p.type === "llm") {
          return {
            ...p,
            value: p.value
              ? addLiteLLMParams(
                  p.value as LLMConfig,
                  modelProviders,
                  onlyCustomKeys
                )
              : getDefaultLLM(),
          };
        }
        return p;
      });

      return { ...node, data: { ...node.data, parameters } };
    }),
  };

  if (event.type === "execute_optimization" && "llm" in event.payload.params) {
    event.payload.params.llm = event.payload.params.llm
      ? addLiteLLMParams(
          event.payload.params.llm,
          modelProviders,
          onlyCustomKeys
        )
      : getDefaultLLM();
  }

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
  modelProviders: Record<string, MaybeStoredModelProvider>,
  customKeysOnly: boolean
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
  if (customKeysOnly && !modelProvider.customKeys) {
    throw new Error(`Custom API key required for ${provider}`);
  }

  return {
    ...llm,
    litellm_params: prepareLitellmParams(llm.model, modelProvider),
  };
};

export const getS3CacheKey = (projectId: string) => {
  const salt = process.env.S3_KEY_SALT;
  if (!salt) {
    return undefined;
  }

  const yearMonth = new Date().toISOString().slice(0, 7); // Gets YYYY-MM

  // Create a hash using project ID, salt, and current year-month
  const hash = crypto
    .createHash("sha256")
    .update(`${projectId}-${salt}-${yearMonth}`)
    .digest("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    // We don't need the full hash, first 16 chars (64 bits) is plenty secure
    .slice(0, 16)
    .toLowerCase();

  return hash;
};
