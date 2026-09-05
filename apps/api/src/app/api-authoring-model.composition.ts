/**
 * The model an AUTHORING surface's feature key resolves to, on this process.
 */
import { HandledError } from "@langwatch/handled-error";
import { ModelProviderExecutionHandleService } from "@langwatch/model-provider-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { nlpProxyBaseUrl } from "@langwatch/workflow-server";

/**
 * Resolves one authoring surface's model.
 */
export type ApiAuthoringModelResolver = (input: {
  projectId: string;
  featureKey: string;
}) => ReturnType<typeof ModelProviderExecutionHandleService.getVercelAIModel>;

/**
 * The resolver, or `undefined` where this process composed no model gateway.
 */
export function composeApiAuthoringModelResolver(options: {
  modelProviders: ModelProviderService | undefined;
  projects: ProjectService | undefined;
  nlpServiceUrl: string | undefined;
}): ApiAuthoringModelResolver | undefined {
  const { modelProviders, projects, nlpServiceUrl } = options;
  if (!modelProviders || !projects || !nlpServiceUrl) return undefined;
  // The engine's address plus the proxy path, joined here because the path is
  // the WORKFLOW feature's and the address is the deployment's — the same join
  // the model gateway's own composition makes.
  const executionProxyBaseUrl = nlpProxyBaseUrl({ baseUrl: nlpServiceUrl });
  return (input) =>
    ModelProviderExecutionHandleService.getVercelAIModel({
      projectId: input.projectId,
      featureKey: input.featureKey,
      modelProviders,
      projects,
      executionProxyBaseUrl,
    });
}

/** Where the execution proxy answers, or nothing where no engine was named. */
export function apiExecutionProxyBaseUrl(nlpServiceUrl: string | undefined): string | undefined {
  return nlpServiceUrl ? nlpProxyBaseUrl({ baseUrl: nlpServiceUrl }) : undefined;
}

/** The refusal an authoring door answers when its capability is not composed. */
export class ApiAuthoringUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAuthoringUnavailableError";
  }
}
