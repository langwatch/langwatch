import crypto from "crypto";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "~/server/api/routers/modelProviders.utils";
import { prisma } from "~/server/db";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";
import { decrypt } from "~/utils/encryption";
import { normalizeToSnakeCase } from "~/utils/normalizeToSnakeCase";
import type { LLMConfig, ServerWorkflow, Workflow } from "~/optimization_studio/types/dsl";
import type { StudioClientEvent } from "~/optimization_studio/types/events";

/**
 * An llm parameter reached dispatch without a model. Persisted DSLs are
 * materialized at save time and legacy ones are migrated on read, so this
 * only fires for stale client state (e.g. a tab predating the node-owned
 * LLM config migration). Mapped to a 422 by the post_event route — it is a
 * fixable configuration problem, not a server fault.
 */
export class LlmModelNotSetError extends Error {
  public readonly cause = "LLM_MODEL_NOT_SET" as const;

  constructor(nodeName?: string) {
    super(
      `LLM node ${
        nodeName ? `"${nodeName}" ` : ""
      }has no model selected. Open the node and choose a model.`,
    );
    this.name = "LlmModelNotSetError";
  }
}

export const addEnvs = async (
  event: StudioClientEvent,
  projectId: string,
): Promise<StudioClientEvent> => {
  if (!("workflow" in event.payload)) {
    return event;
  }

  const [modelProviders, { apiKey }, projectSecrets] = await Promise.all([
    getProjectModelProviders(projectId),
    prisma.project.findUniqueOrThrow({
      where: {
        id: projectId,
      },
      select: {
        apiKey: true,
      },
    }),
    prisma.projectSecret.findMany({
      where: { projectId },
      select: { name: true, encryptedValue: true },
    }),
  ]);

  const secrets: Record<string, string> = {};
  for (const secret of projectSecrets) {
    secrets[secret.name] = decrypt(secret.encryptedValue);
  }

  const workflow_id = event.payload.workflow.workflow_id;
  if (!workflow_id) {
    throw new Error("Workflow ID is required");
  }

  const onlyCustomKeys =
    event.payload.workflow.nodes.some((node) => node.type === "code") ||
    event.type === "execute_optimization" ||
    event.type === "execute_evaluation";

  const workflow: ServerWorkflow = {
    ...(event.payload.workflow as Workflow),
    workflow_id,
    api_key: apiKey,
    project_id: projectId,
    secrets,
    nodes: await Promise.all(
      (event.payload.workflow.nodes as Workflow["nodes"]).map(async (node) => {
        const parameters = await Promise.all(
          node.data.parameters?.map(async (p) => {
            if (p.type === "llm") {
              if (!(p.value as LLMConfig | undefined | null)?.model) {
                throw new LlmModelNotSetError(node.data.name ?? node.id);
              }
              return {
                ...p,
                value: await addLiteLLMParams({
                  llm: p.value as LLMConfig,
                  modelProviders,
                  customKeysOnly: onlyCustomKeys,
                  projectId,
                }),
              };
            }
            return p;
          }) ?? [],
        );

        return { ...node, data: { ...node.data, parameters } };
      }),
    ),
  };

  if (
    event.type === "execute_optimization" &&
    "llm" in event.payload.params &&
    event.payload.params.llm
  ) {
    event.payload.params.llm = await addLiteLLMParams({
      llm: event.payload.params.llm,
      modelProviders,
      customKeysOnly: onlyCustomKeys,
      projectId,
    });
  }

  return {
    ...event,
    payload: {
      ...event.payload,
      workflow,
    } as any,
  };
};

const addLiteLLMParams = async ({
  llm,
  modelProviders,
  customKeysOnly,
  projectId,
}: {
  llm: LLMConfig;
  modelProviders: Record<string, MaybeStoredModelProvider>;
  customKeysOnly: boolean;
  projectId: string;
}) => {
  if (!llm.model) {
    throw new LlmModelNotSetError();
  }
  const provider = llm.model.split("/")[0]!;
  const modelProvider = modelProviders[provider];
  if (!modelProvider) {
    throw new Error(`Model provider not configured: ${provider}`);
  }
  if (!modelProvider.enabled) {
    throw new Error(
      `${provider} model provider is disabled, go to settings to enable it`,
    );
  }

  // Normalize to snake_case format and preserve all parameters (OCP compliant)
  const normalizedLLM = normalizeToSnakeCase(llm);

  return {
    ...normalizedLLM,
    litellm_params: await prepareLitellmParams({
      model: llm.model,
      modelProvider,
      projectId,
    }),
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
