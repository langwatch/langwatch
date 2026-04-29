/**
 * Thin REST client for the CLI's governance read endpoints under
 * `/api/auth/cli/governance/*`. Each endpoint is a tRPC-shaped
 * proxy: same input/output as the corresponding
 * `api.{ingestionSources,activityMonitor,governance}.*` tRPC
 * procedure, just over a Bearer-auth REST transport because the
 * CLI doesn't carry a NextAuth session.
 *
 * Authoring (create / rotate / archive) intentionally stays
 * browser-only — these wrappers are read-only.
 */

import { GovernanceConfig } from "./config";

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
      "Not logged in — run `langwatch login --device` first",
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
