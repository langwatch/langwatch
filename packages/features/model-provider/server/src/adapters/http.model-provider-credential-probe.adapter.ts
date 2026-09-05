import { HandledError, type SerializedHandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  MASKED_KEY_PLACEHOLDER,
  tryGetModelProviderDefinition,
  type ModelProviderCredentialVerdict,
  type ModelProviderService,
  type ModelProviderUncheckedReason,
} from "@langwatch/model-provider-contract";
import {
  ModelProviderCredentialProbePort,
  type ModelProviderEgressPort,
  type ModelProviderEgressResponse,
} from "../ports/model-provider.port";

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

/**
 * The host Gemini Enterprise Agent Platform answers on — Gemini's second door. Lived on the onboarding
 * registry while Agent Platform was its own provider; now that it is a credential mode of `gemini`
 * (whose `apiRoot` stays the Gemini API host), the second host is provider knowledge stated here.
 */
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

/**
 * Every way a credential check can fail, as a coded handled error.
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
    super("provider_service_disabled", `${provider} reports the required API is not enabled`, {
      fault: "customer",
      httpStatus: 403,
      meta: { provider },
      tips: [
        "Enable the Generative Language API in the Google Cloud console.",
        "Or configure a Vertex AI provider, which uses service-account credentials.",
      ],
    });
  }
}

/**
 * The credential exists but its own restrictions refuse this call.
 */
export class ProviderKeyRestrictedError extends HandledError {
  constructor({
    provider,
    reason,
    googleDoor,
  }: {
    provider: string;
    reason: string;
    /**
     * Which Google door refused — the same `API_KEY_SERVICE_BLOCKED` reason means
     * opposite remediations on the two doors (fill in the project/location pair vs
     * clear it), so the presentation registry branches on this.
     */
    googleDoor?: "gemini-api" | "agent-platform";
  }) {
    super("provider_key_restricted", `${provider} refused the API key (${reason})`, {
      fault: "customer",
      httpStatus: 403,
      meta: { provider, reason, ...(googleDoor ? { googleDoor } : {}) },
      tips: ["Adjust the key's restrictions in the Google Cloud console."],
    });
  }
}

/**
 * The provider answered, refused, and did not say anything we can map.
 */
export class ProviderRefusedError extends HandledError {
  constructor({ provider, status }: { provider: string; status: number }) {
    super("provider_refused", `${provider} refused the credential check with ${status}`, {
      fault: "provider",
      httpStatus: 502,
      meta: { provider, status },
    });
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
 * The endpoint answered with a redirect, and we will not follow it.
 */
export class ProviderEndpointRedirectedError extends HandledError {
  constructor({ provider }: { provider: string }) {
    super(
      "provider_endpoint_redirected",
      `The endpoint configured for ${provider} redirects elsewhere`,
      {
        fault: "customer",
        httpStatus: 400,
        meta: { provider },
        tips: [
          "Point the base URL at the address the provider actually serves.",
          "An http:// URL that redirects to https:// is the usual cause.",
        ],
      },
    );
    this.name = "ProviderEndpointRedirectedError";
  }
}

/**
 * The probe never reached the provider, so nothing was learned about the key.
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
      ? ["Check your network connection.", "Check the base URL is correct and reachable."]
      : ["Check your network connection."];

    super("provider_unreachable", `Could not reach ${provider} to check the API key`, {
      fault: "provider",
      httpStatus: 502,
      // `hasConfigurableEndpoint` is in `meta` because the registry entry
      // branches on it: only some providers have a base URL there is any
      // point telling someone to check.
      meta: { provider, hasConfigurableEndpoint },
      tips,
    });
  }
}

/** Longest upstream explanation we keep for the server-side log line. */
const MAX_UPSTREAM_DETAIL_LENGTH = 300;

/**
 * Google answers a refused key with a machine-readable `reason`, and only `API_KEY_INVALID` actually means the key
 * is wrong. The rest are project or key-restriction problems that generating a new key will never fix.
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
function geminiReasonRefusal({
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

  const fromReason = geminiReasonRefusal({
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
  /**
   * Which Google door a `gemini` credential is being checked through. The doors disagree on what a 400
   * means: the Gemini API answers a rejected key with 400, while on Agent Platform's generate-content
   * probe a 400 is a malformed request — never a verdict on the key.
   */
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
            // The key rides in a header, not `?key=`, which Agent Platform also accepts: a credential
            // in a URL reaches access logs, proxy logs and browser history, and both shapes were
            // verified to work. The global host with a region in the path was verified live against
            // two regions (us-central1, europe-west4), both 200 — the same form every other verified
            // shape uses, so this does not special-case a regional subdomain on top of it.
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
function mostInformativeFailure(failures: RankedFailure[]): RankedFailure | undefined {
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
function isRefusedRedirect(err: unknown, egress: ModelProviderEgressPort): boolean {
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
  egress: ModelProviderEgressPort;
}): Promise<{ accepted: true; failure?: undefined } | { accepted: false; failure: RankedFailure }> {
  let response: ProbeResponse;
  try {
    // Through the SSRF validator, not bare `fetch`. Every request here carries a customer's credential to a URL a customer chose. Several providers expose a configurable endpoint, so "the URL on the row" is not a
    // trusted value just because nobody passed one in on this call — an endpoint saved earlier is as attacker-controlled as one supplied now, and the stored key rides along either way. That makes this the shape
    // `utils/ssrfProtection` exists for: a cloud-metadata denylist that applies regardless of configuration, private-address blocking, and IP pinning so a name cannot resolve to something else between the check and
    // the connection. `followRedirects: false` for the reason the webhook destination gives at `httpDestination.ts:39-43`: hop re-validation falls back to the weaker env-gated validator, and — measured on this
    // repo's Node — a cross-origin redirect strips `Authorization` but carries `x-api-key`, `x-goog-api-key` and `xi-api-key` straight through to the new host. A redirect is not something a models listing needs.
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
  egress: ModelProviderEgressPort;
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
function whyNotCheckable({
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

  // Nowhere to ask (e.g. voyage, which has no models listing). Probing anyway would fetch a relative URL, throw, and surface as a misleading
  // "check your network connection". The key is exercised on the first real call instead. The Agent Platform door is exempt, and that
  // exemption is load-bearing: a legacy row reaching it has no onboarding tile left to supply a default base URL, so without this it would
  // be declined without a request and — on the old two-state result — reported as a pass. A key that was never probed coming back green is
  // the failure both this exemption and the third verdict exist to prevent, from either end.
  if (!baseUrl && !defaultBaseUrl && !hasAgentPlatformDoor) {
    return "no_endpoint";
  }

  return null;
}

/**
 * The catalogue's credential probe, over the process's guarded egress.
 */
export class HttpModelProviderCredentialProbeAdapter extends ModelProviderCredentialProbePort {
  /**
   * Validates an API key (from the stored DB value or an env var) against a
   * custom URL, or the default URL when none is given.
   * @param projectId project to look up stored keys for; @param provider e.g. "openai"; @param customBaseUrl optional override.
   */
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
    modelProviders: ModelProviderService;
    /**
     * The process environment the fallback key is read from, passed in rather
     * than read here: a package has no environment of its own, and the caller
     * that has one is the composition root.
     */
    environment: Readonly<Record<string, string | undefined>>;
    egress: ModelProviderEgressPort;
  }): Promise<ModelProviderCredentialVerdict> {
    const providerDef = tryGetModelProviderDefinition(provider);
    if (!providerDef) {
      return unchecked("unknown_provider");
    }

    if (NOT_PROBEABLE.has(provider)) {
      return unchecked("provider_not_probeable");
    }

    const apiKeyField = providerDef.apiKey;
    const endpointField = providerDef.endpointKey;

    // Try to get stored API key from DB (decrypted by repository)
    const storedProvider = await service.tryGetProviderForProject({
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

    // Start from what's stored, not from a blank object: a provider whose credential is more than a key plus an endpoint — Agent
    // Platform's project and location, or any future one — had those fields silently dropped when this rebuilt customKeys from
    // scratch. That turned "the customer edited an unrelated field" into an empty probe walk and a false "could not reach the
    // provider", which is the exact misdiagnosis this whole area of the code exists to remove. The freshly resolved key and an
    // explicit custom URL are layered on top, in that order, so they still win over whatever was stored.
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
    egress: ModelProviderEgressPort,
  ): Promise<ModelProviderCredentialVerdict> {
    // Get provider definition from registry
    const providerDef = tryGetModelProviderDefinition(provider);
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

    const cannotCheck = whyNotCheckable({
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
    egress: ModelProviderEgressPort;
  }): HttpModelProviderCredentialProbeAdapter {
    return new HttpModelProviderCredentialProbeAdapter(input.egress);
  }

  private constructor(private readonly egress: ModelProviderEgressPort) {
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
}

/**
 * The probe a deployment with no guarded egress composes.
 */
export class UnavailableModelProviderCredentialProbeAdapter extends ModelProviderCredentialProbePort {
  static create(): UnavailableModelProviderCredentialProbeAdapter {
    return new UnavailableModelProviderCredentialProbeAdapter();
  }

  probe(_input: {
    provider: string;
    customKeys: Record<string, string>;
  }): Promise<ModelProviderCredentialVerdict> {
    return Promise.resolve({
      outcome: "unchecked",
      valid: true,
      reason: "provider_not_probeable",
    });
  }
}
