/**
 * The model an AUTHORING surface's feature key resolves to, on this process.
 *
 * Four doors dispatch a model on behalf of a person editing something — the
 * Studio's code completion, the dataset editor's row generator, the scenario
 * editor's author-assist and the playground — and none of them may resolve one
 * for itself. WHICH model answers a feature key is the deployment's cascade,
 * held by the model gateway; the feature package owns only the prompt, the
 * schema and the wire.
 *
 * So this is one resolver, over the SAME gateway the execution half composed
 * and the SAME project directory the tenancy half opened, handed to each of
 * them. A second one would let two authoring surfaces resolve the same feature
 * key to different models on one deployment.
 *
 * A process with no gateway REFUSES by name rather than resolving to a
 * default: substituting a model the customer did not configure is the failure
 * the cascade's own refusal exists to prevent.
 */
import { HandledError } from "@langwatch/handled-error";
import { getVercelAIModel } from "@langwatch/model-provider-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { nlpProxyBaseUrl } from "@langwatch/workflow-server";

/**
 * Resolves one authoring surface's model.
 *
 * The handle type is DERIVED from the gateway's own resolver rather than
 * restated, so this process cannot name a model type the gateway has stopped
 * returning — and so the composition root need not depend on the AI SDK to
 * describe a value it only ever passes along.
 */
export type ApiAuthoringModelResolver = (input: {
  projectId: string;
  featureKey: string;
}) => ReturnType<typeof getVercelAIModel>;

/**
 * The resolver, or `undefined` where this process composed no model gateway.
 *
 * `undefined` rather than a resolver that throws, because the absence is what
 * decides whether the four doors are mounted at all: a door that answers 500
 * to every request is worse than one that is honestly not there.
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
    getVercelAIModel({
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
