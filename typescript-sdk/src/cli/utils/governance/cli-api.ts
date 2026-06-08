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
  const f = opts.fetchImpl ?? fetch;
  const res = await f(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401) {
    throw new GovernanceCliError(
      401,
      "unauthorized",
      "Session expired — run `langwatch login --device` again",
    );
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
  const f = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.access_token}`,
    Accept: "application/json",
  };
  if (options.mutating) {
    headers[CLI_SURFACE_HEADER] = CLI_SURFACE_VALUE;
  }
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await f(url, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  if (res.status === 401) {
    throw new GovernanceCliError(
      401,
      "unauthorized",
      "Session expired — run `langwatch login --device` again",
    );
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
