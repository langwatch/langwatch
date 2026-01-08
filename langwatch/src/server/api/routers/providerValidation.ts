import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { providerDefaultBaseUrls } from "../../../features/onboarding/regions/model-providers/registry";
import { modelProviders } from "../../modelProviders/registry";

/** Validation result returned by all validation functions */
export type ValidationResult = { valid: boolean; error?: string };

/**
 * Authentication strategy for API key validation.
 * - `bearer`: Uses `Authorization: Bearer {key}` header (OpenAI-compatible) - DEFAULT
 * - `anthropic`: Uses `x-api-key` header with `anthropic-version`
 * - `gemini`: Uses query parameter `?key=`
 */
type AuthStrategy = "bearer" | "anthropic" | "gemini";

/**
 * Providers that use non-standard auth. All others default to bearer auth.
 */
const PROVIDER_AUTH_OVERRIDES: Partial<Record<string, AuthStrategy>> = {
  anthropic: "anthropic",
  gemini: "gemini",
};

/** Providers with complex auth (AWS, gcloud, etc.) that skip validation */
const SKIP_VALIDATION = new Set(["bedrock", "vertex_ai", "azure"]);

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

  return normalized.endsWith("/models")
    ? normalized
    : `${normalized}/models`;
}

/**
 * Handles HTTP response errors and returns appropriate error messages.
 *
 * @param response - The fetch Response object
 * @returns ValidationResult with error message
 */
function handleHttpError(response: Response): ValidationResult {
  if (response.status === 401 || response.status === 403) {
    return {
      valid: false,
      error: "Invalid API key. Please check your API key and try again.",
    };
  }
  return {
    valid: false,
    error: `API validation failed (${response.status}). Please check your credentials.`,
  };
}

/**
 * Validates using Bearer token authentication (OpenAI-compatible).
 *
 * @param apiKey - The API key to validate
 * @param baseUrl - The user-provided base URL
 * @param defaultBaseUrl - The default base URL for the provider
 * @returns Promise resolving to validation result
 */
async function validateWithBearerToken(
  apiKey: string,
  baseUrl: string,
  defaultBaseUrl: string,
): Promise<ValidationResult> {
  const url = buildModelsEndpointUrl(baseUrl, defaultBaseUrl);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return handleHttpError(response);
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error:
        "Failed to validate API key. Please check your network connection and base URL.",
    };
  }
}

/**
 * Validates using Anthropic's x-api-key header authentication.
 *
 * @param apiKey - The API key to validate
 * @param defaultBaseUrl - The default base URL for Anthropic
 * @returns Promise resolving to validation result
 */
async function validateWithAnthropicAuth(
  apiKey: string,
  defaultBaseUrl: string,
): Promise<ValidationResult> {
  const url = buildModelsEndpointUrl("", defaultBaseUrl);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return handleHttpError(response);
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error:
        "Failed to validate API key. Please check your network connection.",
    };
  }
}

/**
 * Validates using Gemini's query parameter authentication.
 *
 * @param apiKey - The API key to validate
 * @param defaultBaseUrl - The default base URL for Gemini
 * @returns Promise resolving to validation result
 */
async function validateWithGeminiAuth(
  apiKey: string,
  defaultBaseUrl: string,
): Promise<ValidationResult> {
  const url = `${defaultBaseUrl}/models?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // Gemini returns 400 for invalid keys
      if (response.status === 400 || response.status === 403) {
        return {
          valid: false,
          error: "Invalid API key. Please check your API key and try again.",
        };
      }
      return handleHttpError(response);
    }

    return { valid: true };
  } catch {
    return {
      valid: false,
      error:
        "Failed to validate API key. Please check your network connection.",
    };
  }
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
  const defaultBaseUrl = providerDefaultBaseUrls[provider] ?? "";

  switch (authStrategy) {
    case "bearer":
      return validateWithBearerToken(apiKey, baseUrl, defaultBaseUrl);
    case "anthropic":
      return validateWithAnthropicAuth(apiKey, defaultBaseUrl);
    case "gemini":
      return validateWithGeminiAuth(apiKey, defaultBaseUrl);
    default:
      return { valid: true };
  }
}
