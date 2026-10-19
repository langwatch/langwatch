import {
  ProviderEndpointRedirectedError,
  ProviderUnreachableError,
  type ModelProviderCredentialVerdict,
} from "@langwatch/model-provider-contract";

import {
  AGENT_PLATFORM_API_ROOT,
  AGENT_PLATFORM_PROBE_BODY,
  AGENT_PLATFORM_PROBE_MODEL,
  type AuthStrategy,
  buildModelsEndpointUrl,
  modelsEndpointUrl,
} from "../../../rules/model-provider-probe-targets.rules.ts";
import { refused, verified } from "../../../rules/model-provider-probe-upstream.rules.ts";
import {
  FAILURE_RANK,
  type ProbeResponse,
  type RankedFailure,
  handleHttpError,
  pickMostInformativeFailure,
  refusal,
} from "./model-provider-probe-refusal.service.ts";
import type { ModelProviderEgress } from "./ssrf-model-provider-egress.service.ts";

/**
 * Identifies the probe in flight, so a refusal can be explained in terms of
 * the provider the customer is actually configuring.
 */
export type ProbeContext = {
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
function agentPlatformRequest({
  project,
  location,
  apiKey,
  headers,
}: {
  project: string;
  location: string;
  apiKey: string;
  headers: Record<string, string>;
}): ProbeRequest {
  return {
    // Header, not `?key=`: a URL credential reaches access/proxy logs and browser history.
    url:
      `${AGENT_PLATFORM_API_ROOT}/v1/projects/${encodeURIComponent(project)}` +
      `/locations/${encodeURIComponent(location)}/publishers/google/models/` +
      `${AGENT_PLATFORM_PROBE_MODEL}:generateContent`,
    headers: { ...headers, "x-goog-api-key": apiKey },
    method: "POST",
    body: AGENT_PLATFORM_PROBE_BODY,
  };
}

export function buildProbeCandidates({
  provider,
  strategy,
  apiKey,
  baseUrl,
  defaultBaseUrl,
  apiRoot,
  agentPlatform,
}: {
  /** The registry key, which decides how the gateway reads the base URL. */
  provider: string;
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
  const normalisedUrl = modelsEndpointUrl({ provider, baseUrl, defaultBaseUrl });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  switch (strategy) {
    case "anthropic":
      return [
        {
          url: normalisedUrl,
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
        return [agentPlatformRequest({ ...agentPlatform, apiKey, headers })];
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
          url: normalisedUrl,
          headers: { ...headers, Authorization: `Bearer ${apiKey}` },
        },
      ];
  }
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
export async function runProbeChain({
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
