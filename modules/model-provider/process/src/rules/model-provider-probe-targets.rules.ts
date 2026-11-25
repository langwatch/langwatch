import { DEFAULT_AZURE_API_VERSION } from "@langwatch/model-provider-contract";

/**
 * The documented API root and default endpoint of every provider the probe
 * knows how to reach.
 */
export const providerDefaultBaseUrls: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  doubleword: "https://api.doubleword.ai/v1",
};

/** Per provider, the API root a deployment probes in place of the vendor default. */
export type DeployedBaseUrls = Readonly<Record<string, string | undefined>>;

/** Version-less API roots keyed by the backend provider key — see `apiRoot`. */
export const providerApiRoots: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com",
};

/**
 * Authentication strategy for API key validation.
 */
export type AuthStrategy = "bearer" | "anthropic" | "gemini" | "elevenlabs" | "azure";

/**
 * Providers that use non-standard auth. All others default to bearer auth.
 */
export const PROVIDER_AUTH_OVERRIDES: Partial<Record<string, AuthStrategy>> = {
  anthropic: "anthropic",
  gemini: "gemini",
  // Fold-window compatibility: legacy rows validate through the same
  // Agent Platform door as a gemini credential carrying the pair. Goes
  // with the deprecated registry entry.
  google_agent_platform: "gemini",
  elevenlabs: "elevenlabs",
  azure: "azure",
};

/**
 * The model a credential check asks Agent Platform to run.
 */
export const AGENT_PLATFORM_PROBE_MODEL = "gemini-2.5-flash";

/** Agent Platform's own host; `gemini`'s `apiRoot` stays the Gemini API host. */
export const AGENT_PLATFORM_API_ROOT = "https://aiplatform.googleapis.com";

/**
 * The smallest generate-content request that still proves the credential.
 */
export const AGENT_PLATFORM_PROBE_BODY = JSON.stringify({
  contents: [{ role: "user", parts: [{ text: "ping" }] }],
  generationConfig: { maxOutputTokens: 1 },
});

/**
 * The smallest chat completion that still proves an Azure key, endpoint and deployment.
 */
export const AZURE_PROBE_BODY = JSON.stringify({
  messages: [{ role: "user", content: "ping" }],
  max_tokens: 1,
});

/** Azure has no models route: its probe asks one deployment, so it needs a model to name. */
export const PROBE_NEEDS_MODEL: ReadonlySet<string> = new Set(["azure"]);

/**
 * Azure statuses that prove the key and deployment were accepted: Azure authenticates and
 * resolves the deployment before it rate-limits (429) or reads the body (400, e.g. a
 * reasoning deployment refusing `max_tokens`).
 */
const AZURE_REACHABLE_STATUSES: ReadonlySet<number> = new Set([400, 429]);

/** A refusal that still proves the credential: the provider got past auth to say it. */
export function isReachableRefusal({
  provider,
  status,
}: {
  provider: string;
  status: number;
}): boolean {
  return provider === "azure" && AZURE_REACHABLE_STATUSES.has(status);
}

/** One deployment's chat-completions route, at the credential's api-version or the default. */
export function azureChatCompletionsUrl({
  endpoint,
  deployment,
  apiVersion,
}: {
  endpoint: string;
  deployment: string;
  /** The row's AZURE_OPENAI_API_VERSION, so the check runs where execution will. */
  apiVersion?: string;
}): string {
  const root = endpoint.trim().replace(/\/+$/, "");
  const version = apiVersion?.trim() || DEFAULT_AZURE_API_VERSION;
  return (
    `${root}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions` +
    `?api-version=${encodeURIComponent(version)}`
  );
}

/**
 * Providers we will not probe, and must not pretend to have probed.
 */
export const NOT_PROBEABLE: ReadonlySet<string> = new Set([
  "bedrock",
  "vertex_ai",
  "azure_safety",
  // Decision model providers have no models list to probe (ADR-182).
  "inception",
  "perplexity",
  "cloudflare",
  "typesafe",
  "openrouter",
  "fireworks",
] as const);

/**
 * Validation endpoints for providers that are not part of the onboarding registry (which
 * is what feeds `providerDefaultBaseUrls`). ElevenLabs is an audio-only provider added
 * directly in Settings, so its models endpoint lives here.
 */
export const VALIDATION_ONLY_BASE_URLS: Record<string, string> = {
  elevenlabs: "https://api.elevenlabs.io/v1",
};

/**
 * @param baseUrl - The user-provided base URL (may be empty)
 * @param defaultBaseUrl - The default base URL for the provider
 * @returns The full URL to the models endpoint
 */
export function buildModelsEndpointUrl(baseUrl: string, defaultBaseUrl: string): string {
  const endpoint = baseUrl || defaultBaseUrl;
  const normalized = endpoint.replace(/\/$/, "");

  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
}

/**
 * Providers whose base URL the gateway rewrites before calling it: trailing
 * "/v1" and slashes dropped, "/v1/..." appended (normalizeOpenAICompatBaseURL
 * in services/aigateway/adapters/providers/bifrost.go).
 */
const GATEWAY_NORMALISED_BASE_URL_PROVIDERS: ReadonlySet<string> = new Set([
  "openai",
  "custom",
  "anthropic",
]);

/** The models route the gateway's own normalisation of this base URL leads to. */
function gatewayModelsEndpointUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "").replace(/\/+$/, "");
  return `${root}/v1/models`;
}

/**
 * The models URL to ask for one credential. Where the gateway normalises the
 * base URL, only the address it will call is asked: a key answering only at
 * the as-typed address would pass here and fail on every request.
 */
export function modelsEndpointUrl({
  provider,
  baseUrl,
  defaultBaseUrl,
}: {
  provider: string;
  baseUrl: string;
  defaultBaseUrl: string;
}): string {
  if (!baseUrl || !GATEWAY_NORMALISED_BASE_URL_PROVIDERS.has(provider)) {
    return buildModelsEndpointUrl(baseUrl, defaultBaseUrl);
  }
  return gatewayModelsEndpointUrl(baseUrl);
}
