import {
  ENGINE_PROXY_URL_HEADER,
  LANGEVALS_PRIVATE_ENDPOINTS_TTL_SECONDS,
  type LangevalsModelCall,
  type ModelProviderApi,
  type ModelProviderExecutionPrepareInput,
} from "@langwatch/model-provider-contract";
import { nlpInternalSecretHeaders } from "@langwatch/process/nlp-internal-secret";

import type { PrivateModelEndpointService } from "../features/private-endpoint/services/private-model-endpoint.service.ts";
import { engineProxyParameters, isBoundCall } from "../rules/langevals-engine-route.rules.ts";

/**
 * The model calls langevals makes for the app (evaluators, topic clustering). langevals runs
 * litellm, which resolves a host through DNS, so a call to a bound host goes through nlpgo's proxy
 * instead, with the signed bindings; nlpgo pins it (ADR-203). Any other call is left as it was.
 */
export class ModelProviderLangevalsExecutionService {
  readonly #modelProviders: Pick<ModelProviderApi, "prepareExecution">;
  readonly #privateEndpoints: Pick<
    PrivateModelEndpointService,
    "bindingsForProject" | "headersForProject"
  >;
  readonly #executionProxyBaseUrl: string;
  readonly #nlpInternalSecret: string | undefined;

  private constructor(
    options: Parameters<typeof ModelProviderLangevalsExecutionService.create>[0],
  ) {
    this.#modelProviders = options.modelProviders;
    this.#privateEndpoints = options.privateEndpoints;
    this.#executionProxyBaseUrl = options.executionProxyBaseUrl;
    this.#nlpInternalSecret = options.nlpInternalSecret;
  }

  static create(options: {
    modelProviders: Pick<ModelProviderApi, "prepareExecution">;
    privateEndpoints: Pick<PrivateModelEndpointService, "bindingsForProject" | "headersForProject">;
    executionProxyBaseUrl: string;
    /** The engine hop's shared credential; sent to langevals in a header, never in a body. */
    nlpInternalSecret?: string | undefined;
  }): ModelProviderLangevalsExecutionService {
    return new ModelProviderLangevalsExecutionService(options);
  }

  async prepare(input: ModelProviderExecutionPrepareInput): Promise<LangevalsModelCall> {
    const parameters = await this.#modelProviders.prepareExecution(input);
    const unchanged = { parameters, headers: {} };
    if (!parameters.api_base) return unchanged;

    const bindings = await this.#privateEndpoints.bindingsForProject({
      projectId: input.projectId,
    });
    if (!isBoundCall({ parameters, bindings })) return unchanged;

    // No signing key signs nothing: the call keeps its route, where the bound host is refused.
    const privateEndpointsHeaders = await this.#privateEndpoints.headersForProject({
      projectId: input.projectId,
      ttlSeconds: LANGEVALS_PRIVATE_ENDPOINTS_TTL_SECONDS,
    });
    if (Object.keys(privateEndpointsHeaders).length === 0) return unchanged;

    return {
      parameters: engineProxyParameters({
        parameters,
        proxyBaseUrl: this.#executionProxyBaseUrl,
        privateEndpointsHeaders,
      }),
      headers: {
        ...nlpInternalSecretHeaders({ secret: this.#nlpInternalSecret }),
        [ENGINE_PROXY_URL_HEADER]: this.#executionProxyBaseUrl,
      },
    };
  }
}
