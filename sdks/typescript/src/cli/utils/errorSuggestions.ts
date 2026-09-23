/** Error suggestions by code, filling the gap until backend sends them. */
import type { CliHandledError } from "@langwatch/langy-contract/cards/handled-error";

/** The fallback advice for one code. */
export interface ErrorExplanation {
  suggestions: string[];
  docUrl?: string;
}

const DOCS = "https://langwatch.ai/docs";

/**
 * The ~10 codes a CLI user actually meets, mapped to one to three actionable
 * next steps and — where one exists — the docs page that explains the failure.
 * Docs URLs mirror pages in the repo's `docs/` tree (Mintlify path = file path).
 */
const FALLBACK_BY_CODE: Record<string, ErrorExplanation> = {
  missing_api_key: {
    suggestions: [
      "Run `langwatch login` to authenticate",
      "Or set LANGWATCH_API_KEY in your environment or .env file",
    ],
    docUrl: `${DOCS}/integration/cli`,
  },
  unauthorized: {
    suggestions: [
      "Check that your API key is still valid — run `langwatch login` to re-authenticate",
      "Make sure the key belongs to the project you are calling",
    ],
    docUrl: `${DOCS}/platform/api-keys`,
  },
  forbidden: {
    suggestions: ["Ask a workspace admin to grant you access to this project or resource"],
  },
  // The management APIs (organization, members, invites, roles, role bindings,
  // groups, SCIM tokens) answer 402 below an Enterprise plan. Nothing the
  // caller changes about the request fixes that, so the advice is the upgrade
  // path rather than a retry.
  enterprise_plan_required: {
    suggestions: [
      "This capability is part of the Enterprise plan; upgrade the organization's plan to use it",
    ],
    docUrl: `${DOCS}/pricing`,
  },
  not_found: {
    suggestions: [
      "Check the id or handle you passed",
      "List what exists with the matching `langwatch <resource> list` command",
    ],
  },
  project_not_found: {
    suggestions: [
      "Check which project your API key belongs to",
      "Create or select a project in the LangWatch dashboard",
    ],
  },
  validation_error: {
    suggestions: [
      "Check the details above for the exact validation failure",
      "Compare your arguments against the command's `--help` output",
    ],
  },
  not_authenticated: {
    suggestions: ["Run `langwatch login --device` to sign in via your company SSO"],
  },
  // Enabling a provider does not choose a model for a role. The default lives
  // on the Default Models settings page, and is almost always written at the
  // organization scope, so the advice names both.
  model_not_configured: {
    suggestions: [
      "Open Settings, then Default Models in the LangWatch dashboard, and set a model for the role named in this error",
      "Set it at the organization scope so every team and project inherits it",
    ],
    docUrl: `${DOCS}/platform/model-providers`,
  },
  budget_exceeded: {
    suggestions: [
      "Raise or adjust the project's budget in the gateway settings",
      "Or wait for the current budget window to reset",
    ],
    docUrl: `${DOCS}/ai-gateway/budgets`,
  },
  rate_limited: {
    suggestions: [
      "Back off and retry with an exponential delay",
      "Reduce request concurrency if you are running in bulk",
    ],
    docUrl: `${DOCS}/ai-gateway/rate-limits`,
  },
  network_error: {
    suggestions: [
      "Check your network connection",
      "Verify the LangWatch endpoint (LANGWATCH_ENDPOINT) is reachable",
    ],
  },
  internal_error: {
    suggestions: [
      "Retry the command — this is a server-side failure, not something you did",
      "If it persists, share the trace id above with LangWatch support",
    ],
    docUrl: `${DOCS}/support`,
  },
};

/** The fallback advice for a code, or undefined when we have none to give. */
export const fallbackSuggestionsFor = (code: string): ErrorExplanation | undefined =>
  FALLBACK_BY_CODE[code];

/**
 * Fills `suggestions`/`docUrl` from the fallback table -- only when the
 * platform didn't send them. Server-sent advice always wins: it's written
 * next to the code that raised the failure, so it's only ever more specific.
 */
export const withFallbackSuggestions = (domain: CliHandledError): CliHandledError => {
  if (domain.suggestions?.length && domain.docUrl) return domain;

  const fallback = fallbackSuggestionsFor(domain.code);
  if (!fallback) return domain;

  const docUrlOverride = !domain.docUrl && fallback.docUrl ? { docUrl: fallback.docUrl } : {};

  return {
    ...domain,
    ...(domain.suggestions?.length ? {} : { suggestions: fallback.suggestions }),
    ...docUrlOverride,
  };
};
