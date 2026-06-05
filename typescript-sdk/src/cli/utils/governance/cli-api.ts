/**
 * Thin REST client for governance endpoints used by the
 * `langwatch governance ...` CLI namespace.
 *
 * Two transports live in this file:
 *
 *   1. `/api/auth/cli/governance/*` — CLI-specific read proxies for
 *      activity monitor + status that pre-date the public REST
 *      surface. Read-only.
 *   2. `/api/governance/*` — the public REST contract Sergey shipped
 *      at 0bb951160 / 5275e7e11. Full CRUD on IngestionTemplate +
 *      UserIngestionBinding. The CLI sends
 *      `X-LangWatch-Surface: cli` so audit rows land with
 *      `metadata.surface = 'cli'` per @audit-uniform.
 */

import { type GovernanceConfig } from "./config";
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

export interface CliBootstrapProvider {
  name: string;
  displayName: string;
  models: string[];
}

export interface CliBootstrapBudget {
  monthlyLimitUsd: number | null;
  monthlyUsedUsd: number;
  period: string;
}

export interface CliBootstrapResponse {
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
// Sergey's Hono routes at 0bb951160 (templates) + 5275e7e11 (bindings).
// Wire shape locked at 1839d9f54 + 60f769498 (snake_case in/out).
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

export interface UserIngestionBindingRow {
  id: string;
  template_id: string;
  user_id: string;
  organization_id: string;
  personal_project_id: string;
  binding_access_token_prefix: string;
  enabled: boolean;
  created_at: string;
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

// IngestionTemplate verbs ----------------------------------------------------

export async function listIngestionTemplates(
  cfg: GovernanceConfig,
  options: CliApiOptions = {},
): Promise<IngestionTemplateRow[]> {
  // Device-session adapter route — the public REST at
  // /api/governance/ingestion-templates is mounted under createProjectApp
  // and rejects Bearer access tokens with 401. wrapper-mode's auto-install
  // flow has to work with the device-session cfg.access_token, so call the
  // mirror route under /api/auth/cli/governance/* which accepts lw_at_*.
  const body = await requestREST<{ ingestion_templates: IngestionTemplateRow[] }>(
    cfg,
    "GET",
    "/api/auth/cli/governance/ingestion-templates",
    options,
  );
  return body.ingestion_templates;
}

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

// UserIngestionBinding verbs ------------------------------------------------

export async function listUserIngestionBindings(
  cfg: GovernanceConfig,
  options: CliApiOptions = {},
): Promise<UserIngestionBindingRow[]> {
  // Device-session adapter route — see listIngestionTemplates above.
  const body = await requestREST<{
    user_ingestion_bindings: UserIngestionBindingRow[];
  }>(
    cfg,
    "GET",
    "/api/auth/cli/governance/user-ingestion-bindings",
    options,
  );
  return body.user_ingestion_bindings;
}

export async function installUserIngestionBinding(
  cfg: GovernanceConfig,
  /**
   * A template id (string, back-compat) installs a template-backed
   * binding. A `{ sourceType }` object installs a template-free binding
   * for the unified coding assistants (claude / codex / gemini /
   * opencode) — they are no longer ingestion templates, so the server
   * keys the binding on the tool's source slug instead.
   */
  target: string | { templateId?: string; sourceType?: string },
  options: CliApiOptions = {},
): Promise<{
  user_ingestion_binding: UserIngestionBindingRow;
  binding_access_token: string;
}> {
  const body =
    typeof target === "string"
      ? { template_id: target }
      : {
          ...(target.templateId ? { template_id: target.templateId } : {}),
          ...(target.sourceType ? { source_type: target.sourceType } : {}),
        };
  return requestREST(
    cfg,
    "POST",
    "/api/auth/cli/governance/user-ingestion-bindings",
    { ...options, body, mutating: true },
  );
}

export async function uninstallUserIngestionBinding(
  cfg: GovernanceConfig,
  bindingId: string,
  options: CliApiOptions = {},
): Promise<{ ok: true }> {
  return requestREST<{ ok: true }>(
    cfg,
    "DELETE",
    `/api/governance/user-ingestion-bindings/${encodeURIComponent(bindingId)}`,
    { ...options, mutating: true },
  );
}

export async function rotateUserIngestionBindingToken(
  cfg: GovernanceConfig,
  bindingId: string,
  options: CliApiOptions = {},
): Promise<{
  user_ingestion_binding: UserIngestionBindingRow;
  binding_access_token: string;
}> {
  return requestREST(
    cfg,
    "POST",
    `/api/auth/cli/governance/user-ingestion-bindings/${encodeURIComponent(bindingId)}/rotate`,
    { ...options, mutating: true },
  );
}
