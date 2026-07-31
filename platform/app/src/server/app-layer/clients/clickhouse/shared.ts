/**
 * The process-wide ClickHouse client, for the paths that have no composition
 * root to hand them one.
 *
 * This is what `~/server/clickhouse/client.ts` used to be, and it exists for
 * the same narrow set of callers: the metrics collector reading
 * `system.parts`, the TTL reconciler, the migration runner, ops explain. None
 * of them serve a request, so none of them can be handed a dependency by
 * `presets.ts`; all of them act on the deployment rather than on a tenant.
 *
 * It is deliberately **not** the way a repository gets a client. A repository
 * takes a `ClickHouseClientResolver` from the composition root, because that is
 * what carries the tenant — and a repository that reached for this singleton
 * would be reaching for a client with no tenant attached, which is the shape
 * every cross-tenant read starts as.
 */

import type { ClickHouseClient } from "@langwatch/clickhouse";
import {
  type AppClickHouseClient,
  createAppClickHouseClient,
} from "../clickhouseClient.factory";
import { clickhouseClientMetrics } from "../clickhouseClient.metrics";
import { parsePrivateClickHouseUrls } from "./private-endpoints";

let shared: AppClickHouseClient | null = null;

/**
 * The routing key infrastructure paths use. It matches no organisation, so
 * `mappedTenantRouter` resolves it to the shared endpoint — which is the one
 * these callers mean.
 */
const INFRASTRUCTURE_ROUTING_KEY = "__infrastructure__";

const MISSING_URL_BANNER = [
  "",
  "╔══════════════════════════════════════════════════════════════╗",
  "║                                                            ║",
  "║   CLICKHOUSE_URL is not set                                ║",
  "║                                                            ║",
  "║   ClickHouse is the primary data store for LangWatch.      ║",
  "║   The application cannot start without it.                 ║",
  "║                                                            ║",
  "║   Quick start:                                             ║",
  "║     docker run -d -p 8123:8123 clickhouse/clickhouse-server║",
  "║     export CLICKHOUSE_URL=http://localhost:8123/langwatch  ║",
  "║                                                            ║",
  "║   Full guide:                                              ║",
  "║     dev/docs/adr/004-docker-dev-environment.md             ║",
  "║                                                            ║",
  "╚══════════════════════════════════════════════════════════════╝",
  "",
].join("\n");

/**
 * The shared client, or `null` when this process has no ClickHouse to talk to.
 *
 * `null` rather than a throw during a build (`BUILD_TIME`), because module
 * evaluation at build time must not require a running datastore. Everywhere
 * else a missing `CLICKHOUSE_URL` throws: ClickHouse is not optional, and a
 * silent `null` would turn that into a feature quietly doing nothing.
 */
export function getSharedAppClickHouseClient(): AppClickHouseClient | null {
  if (process.env.BUILD_TIME) return null;
  if (shared) return shared;

  const url = process.env.CLICKHOUSE_URL;
  if (!url) {
    console.error(MISSING_URL_BANNER);
    throw new Error("CLICKHOUSE_URL environment variable is required.");
  }

  shared = createAppClickHouseClient({
    url,
    privateUrlsByOrganizationId: parsePrivateClickHouseUrls(),
    observability: { metrics: clickhouseClientMetrics },
  });
  return shared;
}

/**
 * The shared client, or a throw.
 *
 * For the callers that cannot proceed without ClickHouse and have nowhere to
 * report a `null` to — a worker assembling a repository, a router doing the
 * same. `getSharedAppClickHouseClient` only returns `null` during a build, and
 * a build does not construct repositories.
 */
export function requireClickHouse(): AppClickHouseClient {
  const app = getSharedAppClickHouseClient();
  if (!app) {
    throw new Error(
      "ClickHouse is not available in this process. Set CLICKHOUSE_URL.",
    );
  }
  return app;
}

/**
 * The shared endpoint's client for infrastructure work, or `null` when there
 * is none.
 */
export function getInfrastructureClickHouseClient(): ClickHouseClient | null {
  return (
    getSharedAppClickHouseClient()?.resolveClient(INFRASTRUCTURE_ROUTING_KEY) ??
    null
  );
}

/**
 * Whether this deployment has a ClickHouse at all.
 *
 * True when the shared endpoint is configured **or** any private per-organisation
 * endpoint is. Both halves matter: a deployment that pins every organisation to
 * its own endpoint and sets no `CLICKHOUSE_URL` still has ClickHouse, and a
 * check that only read `CLICKHOUSE_URL` would report it absent — feature-gating
 * ClickHouse-backed surfaces off for exactly the customers paying for a
 * dedicated instance.
 */
export function isClickHouseEnabled(): boolean {
  return (
    Boolean(process.env.CLICKHOUSE_URL) || parsePrivateClickHouseUrls().size > 0
  );
}

/**
 * Every ClickHouse endpoint this deployment can reach, labelled.
 *
 * Replaces `getAllClickHouseInstances()`, for the ops paths that must act on
 * all of them — schema drift checks, TTL reconciliation, the cross-tenant
 * object lookup — and it keeps the label because those callers report which
 * endpoint failed. The label is `"shared"` or the organisation id, exactly as
 * before; it is deliberately NOT derived from the target's url, which carries
 * the endpoint's credentials and would put a password into an error message.
 *
 * Deduplicated by target, so two organisations pinned to the same endpoint are
 * visited once. The first organisation to claim a target names it, which is
 * the same arbitrary-but-stable choice the previous implementation made when
 * it deduplicated by url.
 */
export function allClickHouseTargets(): Array<{
  label: string;
  client: ClickHouseClient;
}> {
  const app = getSharedAppClickHouseClient();
  if (!app) return [];

  const privateUrls = parsePrivateClickHouseUrls();
  const labelled: Array<{ label: string; client: ClickHouseClient }> = [];
  const seen = new Set<ClickHouseClient>();

  const add = (label: string, client: ClickHouseClient) => {
    if (seen.has(client)) return;
    seen.add(client);
    labelled.push({ label, client });
  };

  add("shared", app.resolveClient(INFRASTRUCTURE_ROUTING_KEY));
  for (const organizationId of privateUrls.keys()) {
    add(organizationId, app.resolveClient(organizationId));
  }

  return labelled;
}

export async function closeSharedAppClickHouseClient(): Promise<void> {
  if (!shared) return;
  const held = shared;
  shared = null;
  await held.close();
}
