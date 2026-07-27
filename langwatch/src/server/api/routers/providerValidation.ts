import type { PrismaClient } from "@prisma/client";
import { HandledError } from "@langwatch/handled-error";
import { providerDefaultBaseUrls } from "../../../features/onboarding/regions/model-providers/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { ModelProviderRepository } from "../../modelProviders/modelProvider.repository";
import { modelProviders } from "../../modelProviders/registry";

/** Validation result returned by all validation functions */
export type ValidationResult = { valid: boolean; error?: string };

/**
 * Authentication strategy for API key validation.
 * - `bearer`: Uses `Authorization: Bearer {key}` header (OpenAI-compatible) - DEFAULT
 * - `anthropic`: Uses `x-api-key` header with `anthropic-version`
 * - `gemini`: Uses query parameter `?key=`
 * - `elevenlabs`: Uses `xi-api-key` header
 */
type AuthStrategy = "bearer" | "anthropic" | "gemini" | "elevenlabs";

/**
 * Providers that use non-standard auth. All others default to bearer auth.
 */
const PROVIDER_AUTH_OVERRIDES: Partial<Record<string, AuthStrategy>> = {
  anthropic: "anthropic",
  gemini: "gemini",
  elevenlabs: "elevenlabs",
};

/** Providers with complex auth (AWS, gcloud, etc.) that skip validation */
const SKIP_VALIDATION = new Set(["bedrock", "vertex_ai", "azure"]);

/**
 * Validation endpoints for providers that are not part of the onboarding
 * registry (which is what feeds `providerDefaultBaseUrls`). ElevenLabs is an
 * audio-only provider added directly in Settings, so its models endpoint
 * lives here.
 */
const VALIDATION_ONLY_BASE_URLS: Record<string, string> = {
  elevenlabs: "https://api.elevenlabs.io/v1",
};

/**
 * Builds the models endpoint URL by normalizing and appending /models if needed.
 *
 * @param baseUrl - The user-provided base URL (may be empty)
 * @param defaultBaseUrl - The default base URL for the provider
 * @returns The full URL to the models endpoint
 */
function buildModelsEndpointUrl(
  baseUrl: string,
  defaultBaseUrl: string,
): string {
  const endpoint = baseUrl || defaultBaseUrl;
  const normalized = endpoint.replace(/\/$/, "");

  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
}

const INVALID_KEY_MESSAGE =
  "Invalid API key. Please check your API key and try again.";

/** Longest upstream explanation we pass through to the customer. */
const MAX_UPSTREAM_DETAIL_LENGTH = 300;

const GEMINI_RESTRICTION_MESSAGE =
  "This key's restrictions block this request. Allow it in the Google Cloud console, then try again.";

/**
 * Google answers a refused key with a machine-readable `reason`, and only
 * `API_KEY_INVALID` actually means the key is wrong. The rest are project or
 * key-restriction problems that generating a new key will never fix, so they
 * get an explanation the customer can act on instead.
 *
 * This provider is Google AI Studio, at generativelanguage.googleapis.com. A
 * key minted in the Google Cloud console (Agent Platform, Vertex) reaches that
 * host without the API enabled for it, so the refusals below are where a
 * Google Cloud customer lands — and they need the Vertex AI provider, which
 * takes a service account rather than a key. Saying so here is the only place
 * they find out.
 *
 * @see https://cloud.google.com/apis/design/errors
 */
const GEMINI_REASON_MESSAGES: Record<string, string> = {
  API_KEY_INVALID: INVALID_KEY_MESSAGE,
  SERVICE_DISABLED:
    "This key's Google Cloud project does not have the Generative Language API enabled. Enable it in the Google Cloud console, or configure a separate Vertex AI provider with service-account credentials.",
  API_KEY_SERVICE_BLOCKED:
    "This key's API restrictions exclude the Generative Language API. Allow it in the Google Cloud console, or configure a separate Vertex AI provider with service-account credentials.",
  API_KEY_HTTP_REFERRER_BLOCKED: GEMINI_RESTRICTION_MESSAGE,
  API_KEY_IP_ADDRESS_BLOCKED: GEMINI_RESTRICTION_MESSAGE,
  API_KEY_ANDROID_APP_BLOCKED: GEMINI_RESTRICTION_MESSAGE,
  API_KEY_IOS_APP_BLOCKED: GEMINI_RESTRICTION_MESSAGE,
};

/**
 * The probe never reached the provider, so nothing was learned about the key.
 *
 * This is a genuine failure rather than a validation result: a refused key is
 * an answer, an unreachable provider is the absence of one. Raising it as a
 * handled error puts it on the same channel as every other failure — a stable
 * `code`, a `fault` that says whose problem it is, and tips — instead of a
 * bare sentence assembled at the call site.
 */
export class ProviderUnreachableError extends HandledError {
  constructor({
    provider,
    hasConfigurableEndpoint,
  }: {
    provider: string;
    hasConfigurableEndpoint: boolean;
  }) {
    super(
      "provider_unreachable",
      "Could not reach the provider to check this API key.",
      {
        fault: "provider",
        httpStatus: 502,
        meta: { provider },
        tips: hasConfigurableEndpoint
          ? [
              "Check your network connection.",
              "Check the base URL is correct and reachable.",
            ]
          : ["Check your network connection."],
      },
    );
  }
}

/** The refusal as the provider described it, once we can read it. */
type UpstreamRefusal = { message?: string; reason?: string };

/**
 * Pulls the human-readable message out of the error shapes our providers
 * actually return. Google, OpenAI and Anthropic all nest it under `error`;
 * ElevenLabs uses `detail`.
 */
function extractUpstreamMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const { error, message, detail } = body as Record<string, unknown>;

  const candidates = [
    (error as Record<string, unknown> | undefined)?.message,
    error,
    message,
    (detail as Record<string, unknown> | undefined)?.message,
    detail,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

/** Reads Google's `google.rpc.ErrorInfo` reason out of `error.details[]`. */
function extractUpstreamReason(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;

  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) return undefined;

  const details = (error as Record<string, unknown>).details;
  if (!Array.isArray(details)) return undefined;

  for (const detail of details) {
    const reason = (detail as Record<string, unknown> | null)?.reason;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }

  return undefined;
}

/**
 * Strips the submitted key out of text we are about to show or log. Gemini
 * carries the key in the query string, and providers echo the offending
 * request back often enough that this cannot be left to chance.
 */
function redactApiKey(text: string, apiKey: string): string {
  if (apiKey.length < 8) return text;

  const encoded = encodeURIComponent(apiKey);
  const forms = encoded === apiKey ? [apiKey] : [apiKey, encoded];

  return forms.reduce(
    (redacted, form) => redacted.split(form).join("[redacted]"),
    text,
  );
}

/**
 * Reads the provider's own explanation for a refusal. Never throws: an
 * unreadable body just means we fall back to the generic message.
 */
async function readUpstreamRefusal(
  response: Response,
  apiKey: string,
): Promise<UpstreamRefusal> {
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return {};
  }

  if (!raw?.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const message = extractUpstreamMessage(parsed);

  return {
    message: message
      ? redactApiKey(message, apiKey).slice(0, MAX_UPSTREAM_DETAIL_LENGTH)
      : undefined,
    reason: extractUpstreamReason(parsed),
  };
}

/**
 * Turns an HTTP failure into a message the customer can act on, preferring
 * the provider's own explanation over our guess about what went wrong.
 *
 * @param response - The fetch Response object
 * @param context - Which provider was probed, and with which key
 * @returns ValidationResult with error message
 */
async function handleHttpError({
  response,
  context,
}: {
  response: Response;
  context: ProbeContext;
}): Promise<RankedFailure> {
  const { message, reason } = await readUpstreamRefusal(
    response,
    context.apiKey,
  );

  const knownReason = reason ? GEMINI_REASON_MESSAGES[reason] : undefined;
  if (context.provider === "gemini" && knownReason) {
    return {
      valid: false,
      error: knownReason,
      // Only a reason naming something else is worth outranking the
      // provider's own verdict that the key itself is wrong.
      rank:
        knownReason === INVALID_KEY_MESSAGE
          ? FAILURE_RANK.definitive
          : FAILURE_RANK.actionable,
    };
  }

  // Gemini reports a rejected key as 400, every other provider as 401/403.
  const isAuthFailure =
    response.status === 401 ||
    response.status === 403 ||
    (context.provider === "gemini" && response.status === 400);

  if (isAuthFailure) {
    return {
      valid: false,
      error: message ? `${INVALID_KEY_MESSAGE} ${message}` : INVALID_KEY_MESSAGE,
      rank: message ? FAILURE_RANK.explained : FAILURE_RANK.generic,
    };
  }

  return {
    valid: false,
    error: message
      ? `API validation failed (${response.status}). ${message}`
      : `API validation failed (${response.status}). Please check your credentials.`,
    rank: FAILURE_RANK.explained,
  };
}

/**
 * Identifies the probe in flight, so a refusal can be explained in terms of
 * the provider the customer is actually configuring.
 */
type ProbeContext = {
  /** Registry key, e.g. "openai" or "gemini" */
  provider: string;
  /** The key being checked, so it can be kept out of error messages */
  apiKey: string;
  /** Whether the customer can point this provider at their own URL */
  hasConfigurableEndpoint: boolean;
};

/**
 * How long the whole walk gets to find an answer.
 *
 * The budget is shared across every shape rather than granted to each, because
 * a per-shape timeout multiplies: four shapes at ten seconds each would let one
 * black-holed host hold a tRPC request thread for forty. The customer supplies
 * the host for any provider with an endpoint of its own, so this is the only
 * thing bounding it — undici's own default gives up minutes later.
 */
const PROBE_BUDGET_MS = 10_000;

/** The request that proves a key works: list the provider's models. */
type ProbeRequest = { url: string; headers: Record<string, string> };

/**
 * Builds the models request for an auth strategy. Every provider is probed
 * the same way; only where the credential rides differs.
 */
/**
 * Every way a provider's credential can legitimately prove itself.
 *
 * A credential is not tied to one URL. Google alone issues keys from AI
 * Studio, the Cloud console and Agent Platform, and the same key answers on
 * `?key=`, on the `x-goog-api-key` header and on the OpenAI-compatible
 * surface — each of which is a different API with its own enablement. Probing
 * a single hardcoded shape turned "we did not ask the right way" into
 * "your key is invalid", which is the wrong conclusion and not one the
 * customer can act on.
 *
 * The shapes below are the ones verified to answer 200 for a live key. A
 * provider whose auth is unambiguous keeps a single entry; adding a shape is
 * appending to its list.
 */
function buildProbeCandidates({
  strategy,
  apiKey,
  baseUrl,
  defaultBaseUrl,
}: {
  strategy: AuthStrategy;
  apiKey: string;
  baseUrl: string;
  defaultBaseUrl: string;
}): ProbeRequest[] {
  const url = buildModelsEndpointUrl(baseUrl, defaultBaseUrl);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (strategy) {
    case "anthropic":
      return [
        {
          url,
          headers: {
            ...headers,
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      ];
    case "elevenlabs":
      return [{ url, headers: { ...headers, "xi-api-key": apiKey } }];
    case "gemini": {
      // The registry pins one API version; the others live beside it on the
      // same host, so derive the root rather than hardcoding a second URL.
      const root = (baseUrl || defaultBaseUrl)
        .replace(/\/$/, "")
        .replace(/\/v1(beta)?(\/models)?$/, "");
      const key = encodeURIComponent(apiKey);

      return [
        { url: `${root}/v1/models?key=${key}`, headers },
        { url: `${root}/v1beta/models?key=${key}`, headers },
        {
          url: `${root}/v1/models`,
          headers: { ...headers, "x-goog-api-key": apiKey },
        },
        {
          url: `${root}/v1beta/openai/models`,
          headers: { ...headers, Authorization: `Bearer ${apiKey}` },
        },
      ];
    }
    case "bearer":
    default:
      return [
        {
          url,
          headers: { ...headers, Authorization: `Bearer ${apiKey}` },
        },
      ];
  }
}

/**
 * How useful a refusal is to the customer, lowest first.
 *
 * Ranking matters because the shapes do not answer equally well. Asked about
 * a plainly invalid key, the primary endpoints return Google's canonical
 * `API_KEY_INVALID`, while the OpenAI-compatible surface answers with a
 * vaguer "Please pass a valid API key" and no reason at all. Preferring
 * whichever refusal merely differs from our own wording picks that vaguer
 * one and appends it to the canonical sentence, which reads worse than
 * saying nothing.
 */
const FAILURE_RANK = {
  /** A mapped reason naming something the customer can change. */
  actionable: 0,
  /** The provider positively identified the key as invalid. */
  definitive: 1,
  /** An auth failure carrying the provider's own explanation. */
  explained: 2,
  /** An auth failure with nothing to add. */
  generic: 3,
  /** We never got an answer, so this says nothing about the key. */
  unreachable: 4,
} as const;

type RankedFailure = ValidationResult & { rank: number };

/** Picks the refusal worth showing, keeping the first of equally useful ones. */
function mostInformativeFailure(
  failures: RankedFailure[],
): RankedFailure {
  return failures.reduce<RankedFailure>(
    (chosen, failure) => (failure.rank < chosen.rank ? failure : chosen),
    failures[0] ?? {
      valid: false,
      error: INVALID_KEY_MESSAGE,
      rank: FAILURE_RANK.generic,
    },
  );
}

/**
 * Asks the provider to list its models, trying each way the credential could
 * legitimately authenticate. One shape answering is proof the key works, so
 * the chain stops there; only when every shape has been refused is the key
 * reported as unusable.
 *
 * @param candidates - The auth shapes to try, in preference order
 * @param context - Which provider is being probed, and with which key
 * @returns Promise resolving to validation result
 */
async function runProbeChain({
  candidates,
  context,
}: {
  candidates: ProbeRequest[];
  context: ProbeContext;
}): Promise<ValidationResult> {
  const failures: RankedFailure[] = [];

  // One deadline for the walk, not one per shape — see PROBE_BUDGET_MS. The
  // same signal goes to every request, so time already spent is time the
  // remaining shapes do not get.
  const deadline = AbortSignal.timeout(PROBE_BUDGET_MS);

  /** The request never landed, so this says nothing about the key itself. */
  const unreachable = (): RankedFailure => ({
    valid: false,
    error: "Could not reach the provider to check this API key.",
    rank: FAILURE_RANK.unreachable,
  });

  for (const candidate of candidates) {
    if (deadline.aborted) {
      failures.push(unreachable());
      break;
    }

    try {
      const response = await fetch(candidate.url, {
        method: "GET",
        headers: candidate.headers,
        signal: deadline,
      });

      if (response.ok) {
        return { valid: true };
      }

      const failure = await handleHttpError({ response, context });
      failures.push(failure);

      // The provider has positively identified the key as wrong. Asking the
      // remaining shapes cannot change that answer, and each one is another
      // outbound request on this request thread.
      if (failure.rank === FAILURE_RANK.definitive) {
        break;
      }
    } catch {
      failures.push(unreachable());
    }
  }

  const { rank, ...result } = mostInformativeFailure(failures);

  // Nothing answered, so there is no verdict on the key to report — only a
  // failure to have asked.
  if (rank === FAILURE_RANK.unreachable) {
    throw new ProviderUnreachableError({
      provider: context.provider,
      hasConfigurableEndpoint: context.hasConfigurableEndpoint,
    });
  }

  return result;
}

/**
 * Validates an API key against a custom URL or default URL.
 * Gets API key from stored DB value OR env var (whichever exists).
 *
 * @param projectId - The project ID to look up stored keys
 * @param provider - The provider key (e.g., "openai", "anthropic")
 * @param customBaseUrl - Optional custom base URL to validate against. If not provided, uses default URL.
 * @param prisma - Prisma client instance
 * @returns Promise resolving to validation result
 */
export async function validateKeyWithCustomUrl(
  projectId: string,
  provider: string,
  customBaseUrl: string | undefined,
  prisma: PrismaClient,
): Promise<ValidationResult> {
  const providerDef = modelProviders[provider as keyof typeof modelProviders];
  if (!providerDef) {
    return { valid: true }; // Unknown provider, skip validation
  }

  if (SKIP_VALIDATION.has(provider)) {
    return { valid: true };
  }

  const apiKeyField = providerDef.apiKey;
  const endpointField = providerDef.endpointKey;

  // Try to get stored API key from DB (decrypted by repository)
  const repository = new ModelProviderRepository(prisma);
  const storedProvider = await repository.findByProvider(provider, projectId);

  const storedKeys = storedProvider?.customKeys as Record<
    string,
    string
  > | null;
  let apiKey = storedKeys?.[apiKeyField]?.trim() ?? "";

  // Fallback to env var if no stored key
  if (!apiKey) {
    apiKey = process.env[apiKeyField]?.trim() ?? "";
  }

  if (!apiKey) {
    return {
      valid: false,
      error: `No API key found for ${provider}. Please enter an API key.`,
    };
  }

  // Build customKeys with the retrieved API key and optional custom URL
  const customKeys: Record<string, string> = {
    [apiKeyField]: apiKey,
  };
  if (endpointField && customBaseUrl) {
    customKeys[endpointField] = customBaseUrl;
  }
  // Note: if customBaseUrl is not provided, validateProviderApiKey will use the default URL

  return validateProviderApiKey(provider, customKeys);
}

/**
 * Validates an API key for a given model provider.
 *
 * Uses the `modelProviders` registry to dynamically get API key and endpoint
 * field names. All providers use bearer auth by default unless overridden.
 *
 * @param provider - The provider key (e.g., "openai", "anthropic")
 * @param customKeys - Record containing the API key and optional base URL
 * @returns Promise resolving to validation result
 *
 * @remarks
 * - Skips validation if the API key is masked (editing existing provider without changing key)
 * - Skips validation for providers with complex auth (Bedrock, Vertex AI, Azure)
 *
 * @example
 * ```ts
 * const result = await validateProviderApiKey("openai", {
 *   OPENAI_API_KEY: "sk-...",
 *   OPENAI_BASE_URL: "https://api.openai.com/v1"
 * });
 * ```
 */
export async function validateProviderApiKey(
  provider: string,
  customKeys: Record<string, string>,
): Promise<ValidationResult> {
  // Get provider definition from registry
  const providerDef = modelProviders[provider as keyof typeof modelProviders];
  if (!providerDef) {
    return { valid: true }; // Unknown provider, skip validation
  }

  // Skip validation for providers with complex auth (AWS, gcloud, etc.)
  if (SKIP_VALIDATION.has(provider)) {
    return { valid: true };
  }

  // Extract API key and base URL using registry field names
  const apiKeyField = providerDef.apiKey;
  const endpointField = providerDef.endpointKey;

  const apiKey = customKeys[apiKeyField]?.trim() ?? "";
  const baseUrl = endpointField
    ? (customKeys[endpointField]?.trim() ?? "")
    : "";

  // Skip validation if API key is masked (user editing existing provider without changing key)
  if (apiKey === MASKED_KEY_PLACEHOLDER) {
    return { valid: true };
  }

  // Skip validation if no API key provided (schema validation handles required fields)
  // For custom provider, only skip if no base URL either
  if (!apiKey) {
    if (provider !== "custom" || !baseUrl) {
      return { valid: true };
    }
  }

  // Get auth strategy (default to bearer) and base URL
  const authStrategy = PROVIDER_AUTH_OVERRIDES[provider] ?? "bearer";
  const defaultBaseUrl =
    providerDefaultBaseUrls[provider] ??
    VALIDATION_ONLY_BASE_URLS[provider] ??
    "";

  // No endpoint to probe (e.g. voyage, which has no models listing): skip
  // rather than fetch a relative URL, which would always throw and surface
  // as a misleading "check your network connection" error. The key is
  // exercised on the first real call instead.
  if (!baseUrl && !defaultBaseUrl) {
    return { valid: true };
  }

  return runProbeChain({
    candidates: buildProbeCandidates({
      strategy: authStrategy,
      apiKey,
      baseUrl,
      defaultBaseUrl,
    }),
    context: {
      provider,
      apiKey,
      hasConfigurableEndpoint: !!endpointField,
    },
  });
}
