import { type HandledError, type SerializedHandledError } from "@langwatch/handled-error";
import {
  MASKED_KEY_PLACEHOLDER,
  findModelProviderDefinition,
  ProviderEndpointRedirectedError,
  ProviderKeyInvalidError,
  ProviderKeyMissingError,
  ProviderKeyRestrictedError,
  ProviderRefusedError,
  ProviderServiceDisabledError,
  ProviderUnreachableError,
  type ModelProviderCredentialVerdict,
  type ModelProviderApi,
  type ModelProviderUncheckedReason,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import {
  ModelProviderCredentialProbe,
  type ModelProviderEgress,
  type ModelProviderEgressResponse,
} from "../app/model-provider.members.ts";

/**
 * The documented API root and default endpoint of every provider the probe
 * knows how to reach.
 */
const providerDefaultBaseUrls: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  cerebras: "https://api.cerebras.ai/v1",
};

/** Version-less API roots keyed by the backend provider key — see `apiRoot`. */
const providerApiRoots: Record<string, string> = {
  gemini: "https://generativelanguage.googleapis.com",
};

/**
 * The response shape the probe actually receives.
 */
type ProbeResponse = ModelProviderEgressResponse;

/**
 * The verdict this module produces, and the reasons a check never ran.
 */

const verified = (): ModelProviderCredentialVerdict => ({ outcome: "verified", valid: true });

const refused = (domainError: SerializedHandledError): ModelProviderCredentialVerdict => ({
  outcome: "refused",
  valid: false,
  domainError,
});

const unchecked = (reason: ModelProviderUncheckedReason): ModelProviderCredentialVerdict => ({
  outcome: "unchecked",
  valid: true,
  reason,
});

/**
 * Authentication strategy for API key validation.
 */
type AuthStrategy = "bearer" | "anthropic" | "gemini" | "elevenlabs";

/**
 * Providers that use non-standard auth. All others default to bearer auth.
 */
const PROVIDER_AUTH_OVERRIDES: Partial<Record<string, AuthStrategy>> = {
  anthropic: "anthropic",
  gemini: "gemini",
  // Fold-window compatibility: legacy rows validate through the same
  // Agent Platform door as a gemini credential carrying the pair. Goes
  // with the deprecated registry entry.
  google_agent_platform: "gemini",
  elevenlabs: "elevenlabs",
};

/**
 * The model a credential check asks Agent Platform to run.
 */
const AGENT_PLATFORM_PROBE_MODEL = "gemini-2.5-flash";

/** Agent Platform's own host; `gemini`'s `apiRoot` stays the Gemini API host. */
const AGENT_PLATFORM_API_ROOT = "https://aiplatform.googleapis.com";

/**
 * The smallest generate-content request that still proves the credential.
 */
const AGENT_PLATFORM_PROBE_BODY = JSON.stringify({
  contents: [{ role: "user", parts: [{ text: "ping" }] }],
  generationConfig: { maxOutputTokens: 1 },
});

/**
 * Providers we will not probe, and must not pretend to have probed.
 */
const NOT_PROBEABLE: ReadonlySet<string> = new Set([
  "bedrock",
  "vertex_ai",
  "azure",
  "azure_safety",
] as const);

/**
 * Validation endpoints for providers that are not part of the onboarding registry (which
 * is what feeds `providerDefaultBaseUrls`). ElevenLabs is an audio-only provider added
 * directly in Settings, so its models endpoint lives here.
 */
const VALIDATION_ONLY_BASE_URLS: Record<string, string> = {
  elevenlabs: "https://api.elevenlabs.io/v1",
};

/**
 * @param baseUrl - The user-provided base URL (may be empty)
 * @param defaultBaseUrl - The default base URL for the provider
 * @returns The full URL to the models endpoint
 */
function buildModelsEndpointUrl(baseUrl: string, defaultBaseUrl: string): string {
  const endpoint = baseUrl || defaultBaseUrl;
  const normalized = endpoint.replace(/\/$/, "");

  return normalized.endsWith("/models") ? normalized : `${normalized}/models`;
}

const logger = createLogger("langwatch:api:providerValidation");

/** Longest upstream explanation we keep for the server-side log line. */
const MAX_UPSTREAM_DETAIL_LENGTH = 300;

/**
 * Only `API_KEY_INVALID` means the key is wrong; the rest are project/restriction problems.
 * @see https://cloud.google.com/apis/design/errors
 */
const GEMINI_REASON_ERRORS: Record<
  string,
  (args: { provider: string; googleDoor?: "gemini-api" | "agent-platform" }) => HandledError
> = {
  API_KEY_INVALID: ({ provider }) => new ProviderKeyInvalidError({ provider }),
  SERVICE_DISABLED: ({ provider }) => new ProviderServiceDisabledError({ provider }),
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

  return forms.reduce((redacted, form) => redacted.split(form).join("[redacted]"), text);
}

/**
 * Reads the provider's own explanation for a refusal. Never throws: an
 * unreadable body just means we fall back to the generic message.
 */
async function readUpstreamRefusal(
  response: ProbeResponse,
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
 */
function classifyGeminiRefusal({
  provider,
  reason,
  googleDoor,
}: {
  provider: string;
  reason: string | undefined;
  googleDoor?: "gemini-api" | "agent-platform";
}): RankedFailure | undefined {
  // Both Google providers speak the same ErrorInfo shape — the legacy
  // fold-window provider probes the Agent Platform door and its refusals
  // carry the same enumerated reasons.
  if (provider !== "gemini" && provider !== "google_agent_platform") {
    return undefined;
  }
  if (!reason) return undefined;

  const build = GEMINI_REASON_ERRORS[reason];
  if (!build) return undefined;

  const error = build({ provider, googleDoor });

  return refusal(
    error,
    // Only a reason naming something else is worth outranking the provider's
    // own verdict that the key itself is wrong.
    error.code === "provider_key_invalid" ? FAILURE_RANK.definitive : FAILURE_RANK.actionable,
  );
}

/** A refusal, ranked by how much it tells the customer. */
function refusal(error: HandledError, rank: number): RankedFailure {
  return { valid: false, domainError: error.serialize(), rank };
}

/**
 * @param response - The fetch Response object
 * @param context - Which provider was probed, and with which key
 * @returns The refusal, ranked
 */
async function handleHttpError({
  response,
  context,
}: {
  response: ProbeResponse;
  context: ProbeContext;
}): Promise<RankedFailure> {
  const { message, reason } = await readUpstreamRefusal(response, context.apiKey);

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

  const fromReason = classifyGeminiRefusal({
    provider: context.provider,
    reason,
    googleDoor: context.googleDoor,
  });
  if (fromReason) return fromReason;

  // The Gemini API reports a rejected key as 400, every other provider —
  // including Gemini's own Agent Platform door, where 400 is a malformed
  // request — as 401/403.
  const isAuthFailure =
    response.status === 401 ||
    response.status === 403 ||
    (context.provider === "gemini" &&
      context.googleDoor !== "agent-platform" &&
      response.status === 400);

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
  /** Which Google door: the two doors disagree on what a 400 response means for the key. */
  googleDoor?: "gemini-api" | "agent-platform";
};

/**
 * How long the whole walk gets to find an answer.
 */
const PROBE_BUDGET_MS = 10_000;

/**
 * The request that proves a key works.
 */
type ProbeRequest = {
  url: string;
  headers: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
};

/**
 * Every way a provider's credential can legitimately prove itself.
 */
function buildProbeCandidates({
  strategy,
  apiKey,
  baseUrl,
  defaultBaseUrl,
  apiRoot,
  agentPlatform,
}: {
  strategy: AuthStrategy;
  apiKey: string;
  baseUrl: string;
  defaultBaseUrl: string;
  /** The provider's version-less root, when it serves more than one path. */
  apiRoot?: string;
  /** The project and location Agent Platform's path is built from. */
  agentPlatform?: { project: string; location: string };
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
      // A credential carrying a project and location is an Agent Platform key: it
      // names the door it opens, so only that door is asked. The Gemini API host is
      // not probed at all — the key is refused there by its own restrictions, and
      // that refusal would outrank nothing while costing a request. See
      // specs/model-providers/google-agent-platform.feature.
      if (agentPlatform?.project && agentPlatform.location) {
        const { project, location } = agentPlatform;
        const host = AGENT_PLATFORM_API_ROOT;

        return [
          {
            // Header, not `?key=`: a URL credential reaches access/proxy logs and browser history.
            url:
              `${host}/v1/projects/${encodeURIComponent(project)}` +
              `/locations/${encodeURIComponent(location)}/publishers/google/models/` +
              `${AGENT_PLATFORM_PROBE_MODEL}:generateContent`,
            headers: { ...headers, "x-goog-api-key": apiKey },
            method: "POST",
            body: AGENT_PLATFORM_PROBE_BODY,
          },
        ];
      }

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
 */
function pickMostInformativeFailure(failures: RankedFailure[]): RankedFailure | undefined {
  return failures.reduce<RankedFailure | undefined>(
    (chosen, failure) => (!chosen || failure.rank < chosen.rank ? failure : chosen),
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
 * The endpoint answered — with a redirect we will not follow.
 */
function isRefusedRedirect(err: unknown, egress: ModelProviderEgress): boolean {
  return egress.isRedirectRefusal(err);
}

function redirectedFailure(context: ProbeContext): RankedFailure {
  return refusal(
    new ProviderEndpointRedirectedError({ provider: context.provider }),
    // Explained rather than unreachable: this says something actionable about
    // the endpoint, so it should win over a bare timeout from another shape.
    FAILURE_RANK.explained,
  );
}

/**
 * One auth shape, asked once: accepted, refused, or never answered.
 */
async function probeOnce({
  candidate,
  context,
  deadline,
  egress,
}: {
  candidate: ProbeRequest;
  context: ProbeContext;
  deadline: AbortSignal;
  egress: ModelProviderEgress;
}): Promise<{ accepted: true; failure?: undefined } | { accepted: false; failure: RankedFailure }> {
  let response: ProbeResponse;
  try {
    // Through the SSRF validator: a stored endpoint is as attacker-controlled as one passed now,
    // and the credential rides along. `followRedirects: false` because a cross-origin redirect
    // strips `Authorization` but carries `x-api-key`/`x-goog-api-key`/`xi-api-key` to the new host.
    response = await egress.fetch(candidate.url, {
      method: candidate.method ?? "GET",
      headers: candidate.headers,
      ...(candidate.body === undefined ? {} : { body: candidate.body }),
      signal: deadline,
    });
  } catch (err) {
    return {
      accepted: false,
      failure: isRefusedRedirect(err, egress)
        ? redirectedFailure(context)
        : unreachableFailure(context),
    };
  }

  if (response.ok) return { accepted: true };

  return {
    accepted: false,
    failure: await handleHttpError({ response, context }),
  };
}

/**
 * @param candidates - The auth shapes to try, in preference order
 * @param context - Which provider is being probed, and with which key
 * @returns Promise resolving to validation result
 */
async function runProbeChain({
  candidates,
  context,
  egress,
}: {
  candidates: ProbeRequest[];
  context: ProbeContext;
  egress: ModelProviderEgress;
}): Promise<ModelProviderCredentialVerdict> {
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

    const outcome = await probeOnce({ candidate, context, deadline, egress });

    if (outcome.accepted) {
      return verified();
    }

    failures.push(outcome.failure);

    // The provider has positively identified the key as wrong. Asking the
    // remaining shapes cannot change that answer, and each one is another
    // outbound request on this request thread.
    if (outcome.failure.rank === FAILURE_RANK.definitive) {
      break;
    }
  }

  const chosen = pickMostInformativeFailure(failures);

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

  return refused(chosen.domainError);
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

/**
 * The catalogue's credential probe, over the process's guarded egress.
 */
export class HttpModelProviderCredentialProbeAdapter extends ModelProviderCredentialProbe {
  /** Validates a stored or env-var API key against a custom URL, or the default if none given. */
  static async validateKeyWithCustomUrl({
    projectId,
    provider,
    customBaseUrl,
    modelProviders: service,
    environment,
    egress,
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
    let apiKey = storedKeys[apiKeyField]?.trim() ?? "";

    // Fallback to env var if no stored key
    if (!apiKey) {
      apiKey = environment[apiKeyField]?.trim() ?? "";
    }

    if (!apiKey) {
      return refused(new ProviderKeyMissingError({ provider }).serialize());
    }

    // Start from what's stored, not a blank object: rebuilding from scratch silently dropped
    // extra credential fields (Agent Platform's project/location) and misdiagnosed an unrelated
    // edit as an unreachable provider. The resolved key and custom URL still win, layered on top.
    const customKeys: Record<string, string> = {
      ...storedKeys,
      [apiKeyField]: apiKey,
    };
    if (endpointField && customBaseUrl) {
      customKeys[endpointField] = customBaseUrl;
    }
    // Note: if customBaseUrl is not provided, validateProviderApiKey will use the default URL

    return HttpModelProviderCredentialProbeAdapter.validateProviderApiKey(
      provider,
      customKeys,
      egress,
    );
  }

  /**
   * @param provider - The provider key (e.g., "openai", "anthropic")
   * @param customKeys - Record containing the API key and optional base URL
   * @returns Promise resolving to validation result
   */
  static async validateProviderApiKey(
    provider: string,
    customKeys: Record<string, string>,
    egress: ModelProviderEgress,
  ): Promise<ModelProviderCredentialVerdict> {
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
    const defaultBaseUrl =
      providerDefaultBaseUrls[provider] ?? VALIDATION_ONLY_BASE_URLS[provider] ?? "";

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
        strategy: authStrategy,
        apiKey,
        baseUrl,
        defaultBaseUrl,
        apiRoot: providerApiRoots[provider],
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
  }): HttpModelProviderCredentialProbeAdapter {
    return new HttpModelProviderCredentialProbeAdapter(input.egress, input.environment ?? {});
  }

  private constructor(
    private readonly egress: ModelProviderEgress,
    private readonly environment: Readonly<Record<string, string | undefined>>,
  ) {
    super();
  }

  probe(input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict> {
    return HttpModelProviderCredentialProbeAdapter.validateProviderApiKey(
      input.provider,
      input.customKeys,
      this.egress,
    );
  }

  probeStored(input: {
    projectId: string;
    provider: string;
    customBaseUrl: string | undefined;
    modelProviders: Pick<ModelProviderApi, "findProviderForProject">;
  }): Promise<ModelProviderCredentialVerdict> {
    return HttpModelProviderCredentialProbeAdapter.validateKeyWithCustomUrl({
      ...input,
      environment: this.environment,
      egress: this.egress,
    });
  }
}
