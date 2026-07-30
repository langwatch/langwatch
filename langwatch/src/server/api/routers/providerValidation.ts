import {
  HandledError,
  type SerializedHandledError,
} from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import {
  providerApiRoots,
  providerDefaultBaseUrls,
} from "../../../features/onboarding/regions/model-providers/registry";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { ModelProviderRepository } from "../../modelProviders/modelProvider.repository";
import { modelProviders } from "../../modelProviders/registry";

/**
 * The answer to "does this credential work".
 *
 * A refusal travels as a serialized `HandledError`, not as a sentence. It is
 * still a RETURN value rather than a throw — asking a provider and being told
 * no is a successful question, and ADR-045 reserves throwing for the absence
 * of an answer — but the words the customer reads come from the code-keyed
 * registry in `features/errors`, the same as every other failure in the app.
 *
 * The shape follows `target_result.domainError`: a handled error carried on a
 * payload rather than off a transport envelope, read back with
 * `explainSerializedError`.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; domainError: SerializedHandledError };

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

const logger = createLogger("langwatch:api:providerValidation");

/**
 * Every way a credential check can fail, as a coded handled error.
 *
 * None of these carry the provider's own sentence, in any field. A handled
 * error's `message` is NOT private — the REST boundary sends
 * `{ error: code, message }` verbatim (`app/api/middleware/error-handler.ts`)
 * — so "server-side only" is not a property `message` has, and an upstream
 * refusal is precisely the text that quotes the request back: an OpenAI 401
 * body reads `Incorrect API key provided: sk-proj-…`, and for Gemini the
 * request carries the key in its query string.
 *
 * Relaying it through `meta.message` is not the way round this either. That
 * channel exists and is allowlisted per code, but a model provider's rejection
 * was tried there as `llm_upstream_error` and removed for this exact reason —
 * see the note on `ALLOWED_PER_CODE` in
 * `features/errors/logic/__tests__/presentation.unit.test.ts`.
 *
 * So the provider's words go to `logger` beside the throw, where the doc says
 * they belong, and the customer reads this code's entry in
 * `features/errors/logic/presentation.ts`.
 */

/** The provider positively identified the credential itself as wrong. */
export class ProviderKeyInvalidError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super("provider_key_invalid", `${provider} rejected the API key`, {
      fault: "customer",
      httpStatus: 400,
      meta: { provider },
    });
  }
}

/** The credential is fine; the API it needs is switched off for its project. */
export class ProviderServiceDisabledError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super(
      "provider_service_disabled",
      `${provider} reports the required API is not enabled`,
      {
        fault: "customer",
        httpStatus: 403,
        meta: { provider },
        tips: [
          "Enable the Generative Language API in the Google Cloud console.",
          "Or configure a Vertex AI provider, which uses service-account credentials.",
        ],
      },
    );
  }
}

/**
 * The credential exists but its own restrictions refuse this call.
 *
 * `reason` is a discriminant from a set Google enumerates, not free text, so
 * it is safe to carry and to branch copy on.
 */
export class ProviderKeyRestrictedError extends HandledError {
  constructor({ provider, reason }: { provider: string; reason: string }) {
    super(
      "provider_key_restricted",
      `${provider} refused the API key (${reason})`,
      {
        fault: "customer",
        httpStatus: 403,
        meta: { provider, reason },
        tips: ["Adjust the key's restrictions in the Google Cloud console."],
      },
    );
  }
}

/**
 * The provider answered, refused, and did not say anything we can map.
 *
 * `fault: "provider"` because a 429 or a 503 is theirs, not the customer's,
 * and the status is the one fact worth carrying — a number from a known set
 * rather than a sentence.
 */
export class ProviderRefusedError extends HandledError {
  constructor({ provider, status }: { provider: string; status: number }) {
    super(
      "provider_refused",
      `${provider} refused the credential check with ${status}`,
      {
        fault: "provider",
        httpStatus: 502,
        meta: { provider, status },
      },
    );
  }
}

/** There was no credential to check — nothing stored, nothing in the env. */
export class ProviderKeyMissingError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super("provider_key_missing", `No API key stored for ${provider}`, {
      fault: "customer",
      httpStatus: 400,
      meta: { provider },
    });
  }
}

/**
 * The probe never reached the provider, so nothing was learned about the key.
 *
 * The one failure here that is thrown rather than returned: a refused key is
 * an answer, an unreachable provider is the absence of one.
 */
export class ProviderUnreachableError extends HandledError {
  constructor({
    provider,
    hasConfigurableEndpoint,
  }: {
    provider: string;
    hasConfigurableEndpoint: boolean;
  }) {
    const tips = hasConfigurableEndpoint
      ? [
          "Check your network connection.",
          "Check the base URL is correct and reachable.",
        ]
      : ["Check your network connection."];

    super(
      "provider_unreachable",
      `Could not reach ${provider} to check the API key`,
      {
        fault: "provider",
        httpStatus: 502,
        // `hasConfigurableEndpoint` is in `meta` because the registry entry
        // branches on it: only some providers have a base URL there is any
        // point telling someone to check.
        meta: { provider, hasConfigurableEndpoint },
        tips,
      },
    );
  }
}

/** Longest upstream explanation we keep for the server-side log line. */
const MAX_UPSTREAM_DETAIL_LENGTH = 300;

/**
 * Google answers a refused key with a machine-readable `reason`, and only
 * `API_KEY_INVALID` actually means the key is wrong. The rest are project or
 * key-restriction problems that generating a new key will never fix.
 *
 * This provider is Google AI Studio, at generativelanguage.googleapis.com. A
 * key minted in the Google Cloud console (Agent Platform, Vertex) reaches that
 * host without the API enabled for it, so these refusals are where a Google
 * Cloud customer lands — and they need the Vertex AI provider, which takes a
 * service account rather than a key.
 *
 * @see https://cloud.google.com/apis/design/errors
 */
const GEMINI_REASON_ERRORS: Record<
  string,
  (args: { provider: string }) => HandledError
> = {
  API_KEY_INVALID: (args) => new ProviderKeyInvalidError(args),
  SERVICE_DISABLED: (args) => new ProviderServiceDisabledError(args),
  API_KEY_SERVICE_BLOCKED: (args) =>
    new ProviderKeyRestrictedError({
      ...args,
      reason: "API_KEY_SERVICE_BLOCKED",
    }),
  API_KEY_HTTP_REFERRER_BLOCKED: (args) =>
    new ProviderKeyRestrictedError({
      ...args,
      reason: "API_KEY_HTTP_REFERRER_BLOCKED",
    }),
  API_KEY_IP_ADDRESS_BLOCKED: (args) =>
    new ProviderKeyRestrictedError({
      ...args,
      reason: "API_KEY_IP_ADDRESS_BLOCKED",
    }),
  API_KEY_ANDROID_APP_BLOCKED: (args) =>
    new ProviderKeyRestrictedError({
      ...args,
      reason: "API_KEY_ANDROID_APP_BLOCKED",
    }),
  API_KEY_IOS_APP_BLOCKED: (args) =>
    new ProviderKeyRestrictedError({
      ...args,
      reason: "API_KEY_IOS_APP_BLOCKED",
    }),
};

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
 * Google's verdict on the key itself, when it gave one.
 *
 * The only branch that ranks a refusal by what the provider said rather than
 * by the status it said it with, which is why it reads better apart from the
 * status handling below.
 */
function geminiReasonRefusal({
  provider,
  reason,
}: {
  provider: string;
  reason: string | undefined;
}): RankedFailure | undefined {
  if (provider !== "gemini" || !reason) return undefined;

  const build = GEMINI_REASON_ERRORS[reason];
  if (!build) return undefined;

  const error = build({ provider });

  return refusal(
    error,
    // Only a reason naming something else is worth outranking the provider's
    // own verdict that the key itself is wrong.
    error.code === "provider_key_invalid"
      ? FAILURE_RANK.definitive
      : FAILURE_RANK.actionable,
  );
}

/** A refusal, ranked by how much it tells the customer. */
function refusal(error: HandledError, rank: number): RankedFailure {
  return { valid: false, domainError: error.serialize(), rank };
}

/**
 * Turns an HTTP failure into the coded error that best describes it.
 *
 * The provider's own sentence is read, logged, and then dropped. It still
 * decides how a refusal RANKS — a shape that explained itself is a better
 * answer than one that did not — but it never travels, on any field.
 *
 * @param response - The fetch Response object
 * @param context - Which provider was probed, and with which key
 * @returns The refusal, ranked
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

  // The one place the provider's own words are kept. Redacted at the point of
  // reading, because this is a log and the key is what it would otherwise
  // quote back; the customer never sees this line either way.
  logger.info(
    {
      provider: context.provider,
      status: response.status,
      reason,
      upstreamMessage: message,
    },
    "provider refused a credential check",
  );

  const fromReason = geminiReasonRefusal({
    provider: context.provider,
    reason,
  });
  if (fromReason) return fromReason;

  // Gemini reports a rejected key as 400, every other provider as 401/403.
  const isAuthFailure =
    response.status === 401 ||
    response.status === 403 ||
    (context.provider === "gemini" && response.status === 400);

  if (isAuthFailure) {
    return refusal(
      new ProviderKeyInvalidError({ provider: context.provider }),
      message ? FAILURE_RANK.explained : FAILURE_RANK.generic,
    );
  }

  return refusal(
    new ProviderRefusedError({
      provider: context.provider,
      status: response.status,
    }),
    FAILURE_RANK.explained,
  );
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
  apiRoot,
}: {
  strategy: AuthStrategy;
  apiKey: string;
  baseUrl: string;
  defaultBaseUrl: string;
  /** The provider's version-less root, when it serves more than one path. */
  apiRoot?: string;
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
      const key = encodeURIComponent(apiKey);

      // Which paths a provider serves is provider knowledge, so the root
      // comes from the registry rather than being recovered from
      // `defaultBaseUrl` by parsing a URL for its own structure. With no root
      // stated — or a base URL the customer set themselves, whose layout we
      // cannot assume — only the documented shape is probed.
      if (!apiRoot || baseUrl) {
        return [{ url: `${url}?key=${key}`, headers }];
      }

      const root = apiRoot.replace(/\/$/, "");

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

type RankedFailure = {
  valid: false;
  domainError: SerializedHandledError;
  rank: number;
};

/**
 * Picks the refusal worth showing, keeping the first of equally useful ones.
 *
 * Undefined for an empty list rather than a manufactured verdict. Nothing was
 * asked, so there is nothing to report about the key — the caller turns that
 * into `ProviderUnreachableError`. An earlier version defaulted to "invalid
 * API key" here, which is the one answer that is certainly wrong when no
 * request was made, and the exact misdiagnosis this module exists to remove.
 */
function mostInformativeFailure(
  failures: RankedFailure[],
): RankedFailure | undefined {
  return failures.reduce<RankedFailure | undefined>(
    (chosen, failure) =>
      !chosen || failure.rank < chosen.rank ? failure : chosen,
    undefined,
  );
}

/** The request never landed, so this says nothing about the key itself. */
function unreachableFailure(context: ProbeContext): RankedFailure {
  return refusal(
    new ProviderUnreachableError({
      provider: context.provider,
      hasConfigurableEndpoint: context.hasConfigurableEndpoint,
    }),
    FAILURE_RANK.unreachable,
  );
}

/**
 * One auth shape, asked once: accepted, refused, or never answered.
 *
 * Only the request is guarded. Reading the refusal happens outside the
 * `catch`, because the two failures mean opposite things: a throw from
 * `fetch` is the request not landing, while a throw from `handleHttpError` is
 * a bug in our own parsing of a response we did get. Catching both told the
 * customer to check their network connection for a host that had answered
 * perfectly well, and hid the defect completely.
 */
async function probeOnce({
  candidate,
  context,
  deadline,
}: {
  candidate: ProbeRequest;
  context: ProbeContext;
  deadline: AbortSignal;
}): Promise<
  | { accepted: true; failure?: undefined }
  | { accepted: false; failure: RankedFailure }
> {
  let response: Response;
  try {
    response = await fetch(candidate.url, {
      method: "GET",
      headers: candidate.headers,
      signal: deadline,
    });
  } catch {
    return { accepted: false, failure: unreachableFailure(context) };
  }

  if (response.ok) return { accepted: true };

  return {
    accepted: false,
    failure: await handleHttpError({ response, context }),
  };
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

  for (const candidate of candidates) {
    if (deadline.aborted) {
      failures.push(unreachableFailure(context));
      break;
    }

    const outcome = await probeOnce({ candidate, context, deadline });

    if (outcome.accepted) {
      return { valid: true };
    }

    failures.push(outcome.failure);

    // The provider has positively identified the key as wrong. Asking the
    // remaining shapes cannot change that answer, and each one is another
    // outbound request on this request thread.
    if (outcome.failure.rank === FAILURE_RANK.definitive) {
      break;
    }
  }

  const chosen = mostInformativeFailure(failures);

  // Nothing answered — or nothing was even asked — so there is no verdict on
  // the key to report, only a failure to have asked. Thrown rather than
  // returned: every other outcome here is an answer, and this is the absence
  // of one.
  if (!chosen || chosen.rank === FAILURE_RANK.unreachable) {
    throw new ProviderUnreachableError({
      provider: context.provider,
      hasConfigurableEndpoint: context.hasConfigurableEndpoint,
    });
  }

  return { valid: false, domainError: chosen.domainError };
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
      domainError: new ProviderKeyMissingError({ provider }).serialize(),
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
      apiRoot: providerApiRoots[provider],
    }),
    context: {
      provider,
      apiKey,
      hasConfigurableEndpoint: !!endpointField,
    },
  });
}
