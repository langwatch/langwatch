/**
 * Thin REST client for governance endpoints used by the
 * `langwatch governance ...` CLI namespace.
 *
 * Two transports live in this file:
 *
 *   1. `/api/auth/cli/governance/*` — CLI-specific read proxies for
 *      activity monitor + status that pre-date the public REST
 *      surface. Read-only.
 *   2. `/api/governance/*` — the public REST contract for
 *      IngestionTemplate CRUD plus the device-session ingestion-key
 *      mint route. The CLI sends `X-LangWatch-Surface: cli` so audit
 *      rows land with `metadata.surface = 'cli'` per @audit-uniform.
 */

import { type GovernanceConfig } from "./config";
import type { PlatformToolPolicyMap } from "./platform-tool-policy";
import {
  canRefreshSession,
  refreshSession,
  refreshSessionIfExpired,
  type SessionRefreshDeps,
} from "./session-refresh";
import {
  CLI_SURFACE_HEADER,
  CLI_SURFACE_VALUE,
} from "./surface";

export interface IngestionSourceSummary {
  id: string;
  name: string;
  sourceType: string;
  description: string | null;
  status: string;
  lastEventAt: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface ActivityEventDetailRow {
  eventId: string;
  eventType: string;
  actor: string;
  action: string;
  target: string;
  costUsd: number;
  tokensInput: number;
  tokensOutput: number;
  eventTimestampIso: string;
  ingestedAtIso: string;
  rawPayload: string;
}

export interface SourceHealthMetrics {
  events24h: number;
  events7d: number;
  events30d: number;
  lastSuccessIso: string | null;
}

export interface GovernanceSetupState {
  hasPersonalVKs: boolean;
  hasRoutingPolicies: boolean;
  hasIngestionSources: boolean;
  hasAnomalyRules: boolean;
  hasRecentActivity: boolean;
  governanceActive: boolean;
}

export class GovernanceCliError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GovernanceCliError";
  }
}

export interface CliApiOptions {
  fetchImpl?: typeof fetch;
  /** Seams for the automatic session refresh. Tests only. */
  refreshDeps?: SessionRefreshDeps;
  /**
   * Abort the request after this many milliseconds. Set it on any call
   * a user is waiting behind: without it a connection that opens and
   * never answers holds the CLI forever, since fetch has no default
   * timeout of its own.
   */
  timeoutMs?: number;
}

/** Copy shown when the session cannot be recovered without a fresh login. */
export const SESSION_EXPIRED_MESSAGE =
  "Session expired, run `langwatch login --device` again";

/**
 * Send an authenticated control-plane request, keeping the device
 * session alive around it.
 *
 * The access token is short-lived and the refresh token is not, so a
 * spent access token is a routine event rather than a logout: refresh
 * proactively when the recorded expiry has passed, and refresh + retry
 * once when the server rejects the token anyway (a revoked-then-rotated
 * pair, or a clock the device disagrees with). Only a refresh the server
 * itself rejects surfaces as a 401 to the caller.
 */
async function authorizedFetch(
  cfg: GovernanceConfig,
  url: string,
  init: (token: string) => RequestInit,
  opts: CliApiOptions,
): Promise<Response> {
  const f = opts.fetchImpl ?? fetch;
  const deps: SessionRefreshDeps = {
    fetchImpl: opts.fetchImpl,
    ...opts.refreshDeps,
  };
  // Each attempt gets its own signal: one shared deadline would arm the
  // clock before the refresh round-trip and abort the retry early.
  const send = () =>
    f(url, {
      ...init(cfg.access_token!),
      ...(opts.timeoutMs === undefined
        ? {}
        : { signal: AbortSignal.timeout(opts.timeoutMs) }),
    });
  await refreshSessionIfExpired(cfg, deps);

  const res = await send();
  if (res.status !== 401 || !canRefreshSession(cfg)) return res;

  const outcome = await refreshSession(cfg, deps);
  if (outcome.status !== "refreshed") return res;
  // Replaying a POST/PUT/DELETE here is safe only because every
  // control-plane handler validates the bearer before it touches state, so
  // a 401 first attempt cannot have committed a write. That argument is
  // specific to 401: do not widen this retry to statuses such as 409 or 5xx,
  // which can follow a partially applied write.
  return send();
}

async function getJSON<T>(
  cfg: GovernanceConfig,
  path: string,
  opts: CliApiOptions = {},
): Promise<T> {
  if (!cfg.access_token) {
    throw new GovernanceCliError(
      401,
      "not_logged_in",
      "Not logged in. Run `langwatch login --device` first.",
    );
  }
  const url = cfg.control_plane_url.replace(/\/+$/, "") + path;
  const res = await authorizedFetch(
    cfg,
    url,
    (token) => ({
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    }),
    opts,
  );
  if (res.status === 401) {
    throw new GovernanceCliError(401, "unauthorized", SESSION_EXPIRED_MESSAGE);
  }
  if (res.status === 402) {
    const body = (await res.json().catch(() => ({}))) as {
      error_description?: string;
      upgrade_url?: string;
    };
    const description =
      body.error_description ?? "This feature requires an Enterprise plan";
    const upgrade = body.upgrade_url
      ? `\n\n  Upgrade your organization at:\n    ${body.upgrade_url}`
      : "";
    throw new GovernanceCliError(
      402,
      "payment_required",
      `${description}${upgrade}`,
    );
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as {
      error_description?: string;
    };
    throw new GovernanceCliError(
      404,
      "not_found",
      body.error_description ?? "Not found",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GovernanceCliError(
      res.status,
      "other",
      `${res.status} ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

export async function listIngestionSources(
  cfg: GovernanceConfig,
  options: { includeArchived?: boolean } & CliApiOptions = {},
): Promise<IngestionSourceSummary[]> {
  const qs = options.includeArchived ? "?include_archived=1" : "";
  const body = await getJSON<{ sources: IngestionSourceSummary[] }>(
    cfg,
    `/api/auth/cli/governance/ingest/sources${qs}`,
    options,
  );
  return body.sources;
}

export async function getEventsForSource(
  cfg: GovernanceConfig,
  sourceId: string,
  options: { limit?: number; beforeIso?: string } & CliApiOptions = {},
): Promise<ActivityEventDetailRow[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.beforeIso) params.set("before_iso", options.beforeIso);
  const qs = params.toString() ? `?${params.toString()}` : "";
  const body = await getJSON<{ events: ActivityEventDetailRow[] }>(
    cfg,
    `/api/auth/cli/governance/ingest/sources/${encodeURIComponent(
      sourceId,
    )}/events${qs}`,
    options,
  );
  return body.events;
}

export async function getSourceHealth(
  cfg: GovernanceConfig,
  sourceId: string,
  options: CliApiOptions = {},
): Promise<{
  source: { id: string; name: string; status: string };
  health: SourceHealthMetrics;
}> {
  return getJSON(
    cfg,
    `/api/auth/cli/governance/ingest/sources/${encodeURIComponent(
      sourceId,
    )}/health`,
    options,
  );
}

export async function getGovernanceStatus(
  cfg: GovernanceConfig,
  options: CliApiOptions = {},
): Promise<{ setup: GovernanceSetupState }> {
  return getJSON(cfg, `/api/auth/cli/governance/status`, options);
}

/**
 * A coding assistant the member can run via `langwatch <slug>`. Sourced from
 * the org's published coding_assistant catalog tiles, so the CLI only offers
 * tools the org actually publishes.
 */
export interface CliBootstrapTool {
  slug: string;
  displayName: string;
}

/**
 * A model provider the member can mint a personal virtual key for. Sourced
 * from the org's published model_provider catalog tiles. Distinct from a
 * tool: a provider backs a virtual key, a tool is a coding assistant you run.
 */
export interface CliBootstrapProvider {
  name: string;
  displayName: string;
  configured: boolean;
}

export interface CliBootstrapBudget {
  monthlyLimitUsd: number | null;
  monthlyUsedUsd: number;
  period: string;
}

export interface CliBootstrapResponse {
  /**
   * Coding assistants the member can run via `langwatch <slug>`. Empty when
   * the org has published no coding-assistant tiles; the ceremony then falls
   * back to its built-in default wrapper list. `undefined` on legacy servers
   * without the field (same fallback).
   */
  tools?: CliBootstrapTool[];
  providers: CliBootstrapProvider[];
  /**
   * Provider families (e.g. "openai") for which the org has a live, enabled
   * credential the caller can reach - independent of whether a model_provider
   * catalog tile was published. This is what the gateway can actually route
   * through, so the wrapper preflight gates the gateway path on this, NOT on
   * `providers` (which is the admin-curated mint-your-own-VK catalog).
   * `undefined` on legacy servers without the field; the wrapper then falls
   * back to the `providers` tile list for the check.
   */
  gatewayProviders?: string[];
  budget: CliBootstrapBudget;
  /**
   * Server-authoritative gateway base URL. Sourced from the backend's
   * `LW_GATEWAY_BASE_URL` (or its self-hosted/SaaS-aware fallback).
   * Older self-hosted servers without this field fall back to the
   * CLI's local config default — so undefined is the legacy shape, not
   * an error.
   */
  gatewayUrl?: string;
  /**
   * First org admin's email (by createdAt). Rendered as a mailto in
   * wrapper preflight failure messages so non-admin users get a real
   * contact path instead of a vague "ask your admin". `null` when the
   * org has no admin yet; `undefined` on legacy servers without the
   * field (CLI falls back to a generic line).
   */
  adminEmail?: string | null;
  /**
   * Per-(org, tool) path policy map (claude/codex/gemini/opencode/cursor
   * → {allowVk, allowOtelDirect}). The CLI caches this into
   * `cfg.tool_policies` so the wrapper gates path selection on the org's
   * admin choices. `undefined` on legacy servers without the field; the
   * wrapper then falls back to hardcoded defaults.
   */
  toolPolicies?: PlatformToolPolicyMap;
}

/**
 * Fetch the Storyboard Screen 4 ceremony enrichment data —
 * inheritable providers + the user's effective monthly budget.
 *
 * Backend tRPC source: `api.user.cliBootstrap` (Sergey 32cad11ae).
 * REST adapter: `/api/auth/cli/bootstrap` (queued backend follow-up).
 *
 * Graceful degrade: returns null on 404 (older self-hosted server
 * without the REST endpoint) so the CLI ceremony falls back to the
 * basic header + try-it block. Other errors still throw so they can
 * be logged at the call site.
 */
export async function getCliBootstrap(
  cfg: GovernanceConfig,
  options: CliApiOptions = {},
): Promise<CliBootstrapResponse | null> {
  try {
    return await getJSON<CliBootstrapResponse>(
      cfg,
      `/api/auth/cli/bootstrap`,
      options,
    );
  } catch (err) {
    if (err instanceof GovernanceCliError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * One budget that binds the user's key, labelled with its scope. Wire
 * shape of `GET /api/auth/cli/budget-overview` items (which mirrors the
 * tRPC `api.user.budgetOverview` procedure byte-for-byte).
 */
export interface BudgetOverviewItem {
  id: string;
  name: string;
  /** e.g. "whole organization budget", "personal budget". */
  scopePhrase: string;
  /** "MONTH" | "WEEK" | "DAY" | "HOUR" | "MINUTE" | "TOTAL". */
  window: string;
  limitUsd: string;
  spentUsd: string;
  /** Display name when the budget counts a single provider only. */
  providerLabel: string | null;
  /** ISO timestamp of the next reset; null for TOTAL windows. */
  resetsAt: string | null;
  isPerMember: boolean;
}

export interface BudgetOverviewResponse {
  /**
   * False when the org gives this user no member-facing gateway path
   * (governance flag off / not a member): render nothing budget-related.
   */
  gatewayAccess: boolean;
  reason?: string;
  /** Most binding first; empty when no budget applies. */
  budgets: BudgetOverviewItem[];
}

/**
 * Fetch every budget that binds the user's key for the login epilogue.
 * Returns null on 404 (older server without the endpoint) so the caller
 * can fall back to the /bootstrap collapsed budget line.
 */
export async function getBudgetOverview(
  cfg: GovernanceConfig,
  options: CliApiOptions = {},
): Promise<BudgetOverviewResponse | null> {
  try {
    return await getJSON<BudgetOverviewResponse>(
      cfg,
      `/api/auth/cli/budget-overview`,
      options,
    );
  } catch (err) {
    if (err instanceof GovernanceCliError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

// ── Public REST: /api/governance/* ─────────────────────────────────────────
//
// IngestionTemplate CRUD Hono routes. Wire shape is snake_case in/out.
// All mutating calls send X-LangWatch-Surface: cli per @audit-uniform.

export interface IngestionTemplateRow {
  id: string;
  organization_id: string | null;
  slug: string;
  source_type: string;
  display_name: string;
  description: string | null;
  icon_asset: string | null;
  credential_schema: string | null;
  ottl_rules: string;
  platform_published: boolean;
  enabled: boolean;
}

type RestMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function requestREST<T>(
  cfg: GovernanceConfig,
  method: RestMethod,
  path: string,
  options: { body?: unknown; mutating?: boolean } & CliApiOptions = {},
): Promise<T> {
  if (!cfg.access_token) {
    throw new GovernanceCliError(
      401,
      "not_logged_in",
      "Not logged in. Run `langwatch login --device` first.",
    );
  }
  const url = cfg.control_plane_url.replace(/\/+$/, "") + path;
  const buildInit = (token: string): RequestInit => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    if (options.mutating) {
      headers[CLI_SURFACE_HEADER] = CLI_SURFACE_VALUE;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    return {
      method,
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    };
  };
  const res = await authorizedFetch(cfg, url, buildInit, options);
  if (res.status === 204) return undefined as T;
  if (res.status === 401) {
    throw new GovernanceCliError(401, "unauthorized", SESSION_EXPIRED_MESSAGE);
  }
  if (res.status === 403) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string };
    };
    throw new GovernanceCliError(
      403,
      body.error?.code ?? "forbidden",
      body.error?.message ?? "Forbidden",
    );
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new GovernanceCliError(
      404,
      "not_found",
      body.error?.message ?? "Not found",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GovernanceCliError(
      res.status,
      "other",
      `${res.status} ${body.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

// Ingestion key minting ------------------------------------------------------

/**
 * Mint a personal-project ingest-only ApiKey (the `sk-lw-<...>` shape)
 * for a wrapped tool. Returns the plaintext key (shown once) plus the
 * OTLP endpoint the caller should point the tool's exporter at.
 *
 * Device-session adapter route under /api/auth/cli/governance/* so the
 * wrapper's auto-mint flow works with the device-session
 * cfg.access_token (lw_at_*). The public REST mounted under
 * createProjectApp rejects Bearer access tokens with 401, so the CLI
 * uses the mirror route, same as the (now-retired) binding flow did.
 */
export async function mintIngestionKey(
  cfg: GovernanceConfig,
  sourceType: string,
  options: CliApiOptions = {},
): Promise<{ token: string; prefix: string; endpoint: string }> {
  return requestREST<{ token: string; prefix: string; endpoint: string }>(
    cfg,
    "POST",
    "/api/auth/cli/governance/ingestion-key",
    { ...options, body: { source_type: sourceType }, mutating: true },
  );
}


/**
 * Extracts the 16-char lookupId from an ingestion token.
 * Token format: `ik-lw-{16-char lookupId}_{secret}`.
 * Returns the lookupId string, or undefined when the token doesn't match the
 * expected format (older token shapes, malformed cache entries).
 */
export function extractLookupIdFromToken(token: string): string | undefined {
  const match = /^ik-lw-([^_]+)_/.exec(token);
  return match?.[1];
}

// Ingestion key listing -------------------------------------------------------

/**
 * Lists all live (non-revoked) personal-project ingestion keys for the
 * caller's org. Used as a cache-liveness preflight (#4755): before reusing a
 * locally cached token, the wrapper calls this to confirm the key is still
 * active. If the server resolves and the cached lookupId is absent → the key
 * was revoked → mint fresh. If the call rejects (offline / older server) →
 * reuse the cache as-is (offline-first fallback).
 */
export async function listIngestionKeys(
  cfg: GovernanceConfig,
  options: CliApiOptions = {},
): Promise<{ sourceType: string; lookupId: string }[]> {
  const body = await requestREST<{
    keys: Array<{
      source_type: string;
      lookup_id: string;
      ingestion_template_id: string | null;
    }>;
  }>(cfg, "GET", "/api/auth/cli/governance/ingestion-keys", options);
  return body.keys.map((k) => ({
    sourceType: k.source_type,
    lookupId: k.lookup_id,
  }));
}

// IngestionTemplate verbs ----------------------------------------------------

export async function adminListIngestionTemplates(
  cfg: GovernanceConfig,
  options: CliApiOptions = {},
): Promise<IngestionTemplateRow[]> {
  const body = await requestREST<{ ingestion_templates: IngestionTemplateRow[] }>(
    cfg,
    "GET",
    "/api/governance/ingestion-templates/admin",
    options,
  );
  return body.ingestion_templates;
}

export async function getIngestionTemplate(
  cfg: GovernanceConfig,
  id: string,
  options: CliApiOptions = {},
): Promise<IngestionTemplateRow> {
  const body = await requestREST<{ ingestion_template: IngestionTemplateRow }>(
    cfg,
    "GET",
    `/api/governance/ingestion-templates/${encodeURIComponent(id)}`,
    options,
  );
  return body.ingestion_template;
}

export async function createIngestionTemplate(
  cfg: GovernanceConfig,
  input: {
    source_type: string;
    display_name: string;
    description?: string;
    icon_asset?: string;
    credential_schema?: "otlp_token" | "static_api_key" | "agent_id" | null;
    ottl_rules?: string;
  },
  options: CliApiOptions = {},
): Promise<IngestionTemplateRow> {
  const body = await requestREST<{ ingestion_template: IngestionTemplateRow }>(
    cfg,
    "POST",
    "/api/governance/ingestion-templates",
    { ...options, body: input, mutating: true },
  );
  return body.ingestion_template;
}

export async function updateIngestionTemplateOttlRules(
  cfg: GovernanceConfig,
  id: string,
  ottlRules: string,
  options: CliApiOptions = {},
): Promise<IngestionTemplateRow> {
  const body = await requestREST<{ ingestion_template: IngestionTemplateRow }>(
    cfg,
    "PATCH",
    `/api/governance/ingestion-templates/${encodeURIComponent(id)}/ottl-rules`,
    { ...options, body: { ottl_rules: ottlRules }, mutating: true },
  );
  return body.ingestion_template;
}

export async function archiveIngestionTemplate(
  cfg: GovernanceConfig,
  id: string,
  options: CliApiOptions = {},
): Promise<{ ok: true }> {
  return requestREST<{ ok: true }>(
    cfg,
    "DELETE",
    `/api/governance/ingestion-templates/${encodeURIComponent(id)}`,
    { ...options, mutating: true },
  );
}

export async function cloneIngestionTemplateFromPlatform(
  cfg: GovernanceConfig,
  sourceTemplateId: string,
  options: CliApiOptions = {},
): Promise<IngestionTemplateRow> {
  const body = await requestREST<{ ingestion_template: IngestionTemplateRow }>(
    cfg,
    "POST",
    "/api/governance/ingestion-templates/clone-from-platform",
    {
      ...options,
      body: { source_template_id: sourceTemplateId },
      mutating: true,
    },
  );
  return body.ingestion_template;
}
