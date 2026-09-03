/**
 * What to DO about a failure, keyed on the platform's error code.
 *
 * The backend will grow `suggestions`/`docUrl` on `HandledError` (backend
 * owners — see dev/docs/lw-cli-compat-matrix.md §6), and the moment a route
 * sends them they win. Until then the CLI would render a perfectly structured
 * error with no way forward in it, so this table fills the gap client-side for
 * the handful of codes a CLI user hits most — the same code-keyed pattern the
 * app already uses in `packages/features/langy/web/src/features/langy/behavior/logic/langy-error-explainer.ts`.
 *
 * Keys are EXACT codes, never prefix matches: an unknown code gets no invented
 * advice, and a new backend code lands nowhere rather than in the wrong bucket.
 */
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
 * Fill `suggestions`/`docUrl` from the fallback table — ONLY when the platform
 * did not send them. Server-sent advice always wins: it is written next to the
 * code that raised the failure, so it can only be more specific than a table
 * shipped with the CLI.
 */
export const withFallbackSuggestions = (domain: CliHandledError): CliHandledError => {
  if (domain.suggestions?.length && domain.docUrl) return domain;

  const fallback = fallbackSuggestionsFor(domain.code);
  if (!fallback) return domain;

  return {
    ...domain,
    ...(domain.suggestions?.length ? {} : { suggestions: fallback.suggestions }),
    ...(domain.docUrl ? {} : fallback.docUrl ? { docUrl: fallback.docUrl } : {}),
  };
};
