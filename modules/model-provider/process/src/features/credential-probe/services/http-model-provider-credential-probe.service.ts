import {
  MASKED_KEY_PLACEHOLDER,
  findModelProviderDefinition,
  ModelProviderInvalidError,
  ProviderKeyMissingError,
  type ModelProviderCredentialVerdict,
  type ModelProviderApi,
  type ModelProviderUncheckedReason,
} from "@langwatch/model-provider-contract";

import {
  type DeployedBaseUrls,
  NOT_PROBEABLE,
  PROVIDER_AUTH_OVERRIDES,
  VALIDATION_ONLY_BASE_URLS,
  providerApiRoots,
  providerDefaultBaseUrls,
} from "../../../rules/model-provider-probe-targets.rules.ts";
import { refused, unchecked } from "../../../rules/model-provider-probe-upstream.rules.ts";
import { buildProbeCandidates, runProbeChain } from "./model-provider-probe-chain.service.ts";
import type { ModelProviderEgress } from "./ssrf-model-provider-egress.service.ts";

/**
 * The stored-credential probe, separated from {@link ModelProviderCatalog}
 * because it's the one answer that leaves the process: a deployment with no
 * egress can refuse it by name, rather than reporting an unchecked credential as working.
 */
export abstract class ModelProviderCredentialProbe {
  abstract probe(input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict>;
  /**
   * The stored (or this deployment's own environment) credential, probed
   * against a caller-overridable base URL. The gateway is passed in, not
   * held: which rows this probe reads is the application's, not the fence's.
   */
  abstract probeStored(input: {
    projectId: string;
    provider: string;
    customBaseUrl: string | undefined;
    modelProviders: Pick<ModelProviderApi, "findProviderForProject">;
  }): Promise<ModelProviderCredentialVerdict>;
  /** Refuses a credential write whose endpoint the egress fence would refuse to reach. */
  abstract assertEndpointAllowed(input: {
    provider: string;
    customKeys: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Which of Google's two doors a credential is being checked against, for the
 * providers that have two.
 */
function googleDoorFor({
  provider,
  agentPlatform,
}: {
  provider: string;
  agentPlatform: { project: string; location: string };
}): { googleDoor?: "agent-platform" | "gemini-api" } {
  if (provider !== "gemini" && provider !== "google_agent_platform") {
    return {};
  }
  return {
    googleDoor: agentPlatform.project && agentPlatform.location ? "agent-platform" : "gemini-api",
  };
}

/**
 * The project and location that name Gemini's Agent Platform door, if the
 * credential carries them.
 */
function agentPlatformPair({
  provider,
  customKeys,
}: {
  provider: string;
  customKeys: Record<string, string>;
}): { project: string; location: string } {
  if (provider === "google_agent_platform") {
    return {
      project: customKeys.GOOGLE_AGENT_PLATFORM_PROJECT?.trim() ?? "",
      location: customKeys.GOOGLE_AGENT_PLATFORM_LOCATION?.trim() ?? "",
    };
  }
  return {
    project: customKeys.GEMINI_PROJECT?.trim() ?? "",
    location: customKeys.GEMINI_LOCATION?.trim() ?? "",
  };
}

/**
 * The credential-shaped reasons we decline to ask: nothing usable to send,
 * or nowhere to send it.
 */
function detectUncheckableReason({
  provider,
  apiKey,
  baseUrl,
  defaultBaseUrl,
  hasAgentPlatformDoor,
}: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  defaultBaseUrl: string;
  /**
   * Whether the credential names the Agent Platform door (a project and a location). That
   * probe builds its URL from the API root and needs no base URL, so "nowhere to ask" is
   * false for it however empty the endpoint fields are.
   */
  hasAgentPlatformDoor: boolean;
}): ModelProviderUncheckedReason | null {
  // The stored value came back as the mask, not a credential — the customer is
  // editing a provider without touching its key.
  if (apiKey === MASKED_KEY_PLACEHOLDER) {
    return "credential_masked";
  }

  // No key at all. `custom` is the exception: an endpoint on its own is worth
  // probing, since that is the part most likely to be wrong.
  if (!apiKey && (provider !== "custom" || !baseUrl)) {
    return "no_credential";
  }

  // Nowhere to ask (e.g. voyage): probing would fetch a relative URL and surface as a misleading
  // network error, so the key is exercised on the first real call instead. Agent Platform is
  // exempt since a legacy row has no tile left to supply a default base URL.
  if (!baseUrl && !defaultBaseUrl && !hasAgentPlatformDoor) {
    return "no_endpoint";
  }

  return null;
}

function defaultBaseUrlFor({
  provider,
  deployedBaseUrls,
}: {
  provider: string;
  deployedBaseUrls: DeployedBaseUrls;
}): string {
  return (
    deployedBaseUrls[provider]?.trim() ||
    (providerDefaultBaseUrls[provider] ?? VALIDATION_ONLY_BASE_URLS[provider] ?? "")
  );
}

/**
 * Two endpoint spellings name the same address once trimmed of edge whitespace and
 * trailing slashes.
 */
function sameEndpoint(left: string, right: string): boolean {
  const normalize = (url: string) => url.trim().replace(/\/+$/, "");
  return normalize(left) === normalize(right);
}

/**
 * The catalogue's credential probe, over the process's guarded egress.
 */
export class HttpModelProviderCredentialProbeService extends ModelProviderCredentialProbe {
  /** Validates a stored or env-var API key against a custom URL, or the default if none given. */
  static async validateKeyWithCustomUrl({
    projectId,
    provider,
    customBaseUrl,
    modelProviders: service,
    environment,
    egress,
    deployedBaseUrls,
  }: {
    projectId: string;
    provider: string;
    customBaseUrl: string | undefined;
    modelProviders: Pick<ModelProviderApi, "findProviderForProject">;
    /**
     * The process environment the fallback key is read from, passed in rather
     * than read here: a package has no environment of its own, and the caller
     * that has one is the composition root.
     */
    environment: Readonly<Record<string, string | undefined>>;
    egress: ModelProviderEgress;
    deployedBaseUrls?: DeployedBaseUrls;
  }): Promise<ModelProviderCredentialVerdict> {
    const providerDef = findModelProviderDefinition(provider);
    if (!providerDef) {
      return unchecked("unknown_provider");
    }

    if (NOT_PROBEABLE.has(provider)) {
      return unchecked("provider_not_probeable");
    }

    const apiKeyField = providerDef.apiKey;
    const endpointField = providerDef.endpointKey;

    // Try to get stored API key from DB (decrypted by repository)
    const storedProvider = await service.findProviderForProject({
      projectId,
      provider,
    });

    const storedKeys = Object.fromEntries(
      Object.entries(storedProvider?.customKeys ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    // A stored key goes only to the stored (or default) endpoint, the deployment's own key only
    // to the default one. A probe against any other address takes the key typed with it,
    // through validateProviderApiKey.
    const defaultBaseUrl = defaultBaseUrlFor({
      provider,
      deployedBaseUrls: deployedBaseUrls ?? {},
    });
    const storedBaseUrl = endpointField ? (storedKeys[endpointField]?.trim() ?? "") : "";
    const endpoint = (endpointField ? customBaseUrl?.trim() : "") || storedBaseUrl;
    const target = endpoint || defaultBaseUrl;
    const storedKey = sameEndpoint(target, storedBaseUrl || defaultBaseUrl)
      ? (storedKeys[apiKeyField]?.trim() ?? "")
      : "";
    const environmentKey = sameEndpoint(target, defaultBaseUrl)
      ? (environment[apiKeyField]?.trim() ?? "")
      : "";
    const apiKey = storedKey || environmentKey;

    if (!apiKey) {
      return refused(new ProviderKeyMissingError({ provider }).serialize());
    }

    // Start from what's stored, not a blank object: rebuilding from scratch silently dropped
    // extra credential fields (Agent Platform's project/location) and misdiagnosed an unrelated
    // edit as an unreachable provider. The resolved key and endpoint still win, layered on top.
    const customKeys: Record<string, string> = {
      ...storedKeys,
      [apiKeyField]: apiKey,
    };
    if (endpointField && endpoint) {
      customKeys[endpointField] = endpoint;
    }

    return HttpModelProviderCredentialProbeService.validateProviderApiKey({
      provider,
      customKeys,
      egress,
      deployedBaseUrls,
    });
  }

  /**
   * @param provider - The provider key (e.g., "openai", "anthropic")
   * @param customKeys - Record containing the API key and optional base URL
   * @returns Promise resolving to validation result
   */
  static async validateProviderApiKey({
    provider,
    customKeys,
    egress,
    deployedBaseUrls = {},
  }: {
    provider: string;
    customKeys: Record<string, string>;
    egress: ModelProviderEgress;
    deployedBaseUrls?: DeployedBaseUrls;
  }): Promise<ModelProviderCredentialVerdict> {
    // Get provider definition from registry
    const providerDef = findModelProviderDefinition(provider);
    if (!providerDef) {
      return unchecked("unknown_provider");
    }

    if (NOT_PROBEABLE.has(provider)) {
      return unchecked("provider_not_probeable");
    }

    // Extract API key and base URL using registry field names
    const apiKeyField = providerDef.apiKey;
    const endpointField = providerDef.endpointKey;

    const apiKey = customKeys[apiKeyField]?.trim() ?? "";
    const baseUrl = endpointField ? (customKeys[endpointField]?.trim() ?? "") : "";

    // Get auth strategy (default to bearer) and base URL
    const authStrategy = PROVIDER_AUTH_OVERRIDES[provider] ?? "bearer";
    const deployedBaseUrl = deployedBaseUrls[provider]?.trim() ?? "";
    const defaultBaseUrl = defaultBaseUrlFor({ provider, deployedBaseUrls });

    const agentPlatform = agentPlatformPair({ provider, customKeys });

    const cannotCheck = detectUncheckableReason({
      provider,
      apiKey,
      baseUrl,
      defaultBaseUrl,
      hasAgentPlatformDoor: !!agentPlatform.project && !!agentPlatform.location,
    });
    if (cannotCheck) {
      return unchecked(cannotCheck);
    }

    return runProbeChain({
      candidates: buildProbeCandidates({
        provider,
        strategy: authStrategy,
        apiKey,
        baseUrl,
        defaultBaseUrl,
        apiRoot: deployedBaseUrl ? undefined : providerApiRoots[provider],
        agentPlatform,
      }),
      context: {
        provider,
        apiKey,
        hasConfigurableEndpoint: !!endpointField,
        ...googleDoorFor({ provider, agentPlatform }),
      },
      egress,
    });
  }

  static create(input: {
    egress: ModelProviderEgress;
    /**
     * The process environment a system provider's fallback credential is read
     * from. Passed rather than read here: a package has no environment of its
     * own, and the caller that has one is the composition root.
     */
    environment?: Readonly<Record<string, string | undefined>>;
    /** Per provider, the API root this deployment probes in place of the vendor's own. */
    deployedBaseUrls?: DeployedBaseUrls;
  }): HttpModelProviderCredentialProbeService {
    return new HttpModelProviderCredentialProbeService(
      input.egress,
      input.environment ?? {},
      input.deployedBaseUrls ?? {},
    );
  }

  private constructor(
    private readonly egress: ModelProviderEgress,
    private readonly environment: Readonly<Record<string, string | undefined>>,
    private readonly deployedBaseUrls: DeployedBaseUrls,
  ) {
    super();
  }

  probe(input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict> {
    return HttpModelProviderCredentialProbeService.validateProviderApiKey({
      provider: input.provider,
      customKeys: input.customKeys,
      egress: this.egress,
      deployedBaseUrls: this.deployedBaseUrls,
    });
  }

  async assertEndpointAllowed(input: {
    provider: string;
    customKeys: Record<string, unknown>;
  }): Promise<void> {
    const endpointField = findModelProviderDefinition(input.provider)?.endpointKey;
    const endpoint = endpointField ? input.customKeys[endpointField] : undefined;
    if (typeof endpoint !== "string" || endpoint.trim() === "") return;

    await this.egress.assertDestination(endpoint.trim()).catch((error: unknown) => {
      throw new ModelProviderInvalidError(
        error instanceof Error ? error.message : "The endpoint is not allowed",
        "endpoint_not_allowed",
      );
    });
  }

  probeStored(input: {
    projectId: string;
    provider: string;
    customBaseUrl: string | undefined;
    modelProviders: Pick<ModelProviderApi, "findProviderForProject">;
  }): Promise<ModelProviderCredentialVerdict> {
    return HttpModelProviderCredentialProbeService.validateKeyWithCustomUrl({
      ...input,
      environment: this.environment,
      egress: this.egress,
      deployedBaseUrls: this.deployedBaseUrls,
    });
  }
}
