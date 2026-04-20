/**
 * Cross-surface product action telemetry.
 *
 * Emits a single `product_action` event per organization per action per UTC day,
 * regardless of which surface (web, sdk-python, sdk-ts, cli, mcp, otel) drove it.
 * That one event powers org-WAU, core-action WAU, surface breadth and W4 retention
 * without counting raw request volume.
 *
 * Design notes (important for downstream analytics hygiene):
 * - ONE event name (`product_action`), discriminated by `properties.action`. Makes
 *   PostHog insights trivial and keeps the event schema stable as we add actions.
 * - Property names are snake_case and stable — analytics consumers depend on them.
 * - Once-per-project-per-action-per-day dedup via Redis SET NX EX. We dedup on
 *   project (not org) because projectId is always cheap to obtain at call sites,
 *   whereas orgId sometimes requires a DB join. PostHog `$groups.organization`
 *   still rolls up the event to org-WAU; we just emit one event per project per
 *   day instead of one per org. Missing Redis is treated as fail-open (emit).
 * - No PII in properties. Only IDs and surface metadata.
 * - Fire-and-forget: telemetry must never block or throw into the request path.
 */
import { connection, isBuildOrNoRedis } from "~/server/redis";
import { trackServerEvent } from "~/server/posthog";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:telemetry:product_action");

export const PRODUCT_ACTIONS = [
  "trace_ingested",
  "evaluation_run",
  "prompt_fetched",
  "dataset_created",
  "annotation_added",
  "workflow_run",
  "playground_run",
  "scenario_run",
  "monitor_created",
] as const;

export type ProductAction = (typeof PRODUCT_ACTIONS)[number];

/**
 * Surface = who the caller is (the client that initiated the action), NOT the
 * transport protocol. `otel` is intentionally excluded — OTel is a protocol a
 * caller may use; a Python SDK can send via OTel. If we need to distinguish
 * ingestion protocols later, add a separate `ingestion_protocol` property.
 */
export const SURFACES = [
  "web",
  "sdk-python",
  "sdk-ts",
  "cli",
  "mcp",
  "unknown",
] as const;

export type Surface = (typeof SURFACES)[number];

const CLIENT_HEADER = "x-langwatch-client";
const CI_HEADER = "x-langwatch-ci";

/**
 * Parses an `x-langwatch-client: <name>/<version>` header into a known surface
 * and version. Unknown or missing values fall back to `{ surface: "unknown" }`
 * so the metric still counts the org — analytics has an explicit bucket for
 * un-instrumented clients.
 */
export function parseClientHeader(
  clientHeader: string | undefined | null,
): { surface: Surface; surface_version?: string } {
  if (!clientHeader) return { surface: "unknown" };
  const [rawName, rawVersion] = clientHeader.split("/", 2);
  const name = rawName?.trim().toLowerCase();
  const match = (SURFACES as readonly string[]).includes(name ?? "")
    ? (name as Surface)
    : "unknown";
  return {
    surface: match,
    ...(rawVersion ? { surface_version: rawVersion.trim() } : {}),
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Returns true iff this is the first call today (UTC) for the given
 * organization/action pair. When Redis is not available, returns true
 * (fail-open) so we never silently drop a day's signal.
 */
async function shouldEmitToday({
  projectId,
  action,
}: {
  projectId: string;
  action: ProductAction;
}): Promise<boolean> {
  if (isBuildOrNoRedis || !connection) return true;
  const key = `telemetry:product_action:${projectId}:${action}:${todayUtc()}`;
  try {
    const result = await connection.set(key, "1", "EX", 86400, "NX");
    return result === "OK";
  } catch (err) {
    logger.warn({ err, key }, "redis dedup failed; emitting anyway");
    return true;
  }
}

export interface TrackProductActionArgs {
  action: ProductAction;
  projectId: string;
  /**
   * Either the org id directly (when cheap to obtain at the call site, e.g.
   * a Hono route that already loaded `project.team.organizationId`) OR a lazy
   * resolver called only *after* the dedup check passes. The resolver avoids
   * a DB query on every deduped request.
   */
  organizationId?: string | (() => Promise<string | undefined>);
  userId?: string;
  surface: Surface;
  surfaceVersion?: string;
  isCi?: boolean;
  route?: string;
}

/**
 * Fire-and-forget emission of a deduplicated `product_action` event.
 * Awaiting is safe (it resolves once the dedup check finishes) but callers
 * may also discard the returned promise — any failure is logged, never thrown.
 */
export async function trackProductAction(
  args: TrackProductActionArgs,
): Promise<void> {
  try {
    const shouldEmit = await shouldEmitToday({
      projectId: args.projectId,
      action: args.action,
    });
    if (!shouldEmit) return;

    const organizationId =
      typeof args.organizationId === "function"
        ? await args.organizationId()
        : args.organizationId;

    const groups: Record<string, string> = { project: args.projectId };
    if (organizationId) groups.organization = organizationId;

    trackServerEvent({
      event: "product_action",
      userId: args.userId,
      distinctId: args.userId ?? `project:${args.projectId}`,
      groups,
      properties: {
        action: args.action,
        surface: args.surface,
        ...(args.surfaceVersion
          ? { surface_version: args.surfaceVersion }
          : {}),
        is_ci: args.isCi ?? false,
        ...(args.route ? { route: args.route } : {}),
        project_id: args.projectId,
        ...(organizationId ? { organization_id: organizationId } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, action: args.action }, "trackProductAction failed");
  }
}

/**
 * Convenience helper for callers that have raw request headers. Reads the
 * `x-langwatch-client` and `x-langwatch-ci` headers and returns the subset
 * of `TrackProductActionArgs` they determine.
 */
export function readClientContext(
  headerGet: (name: string) => string | undefined | null,
): Pick<TrackProductActionArgs, "surface" | "surfaceVersion" | "isCi"> {
  const { surface, surface_version } = parseClientHeader(
    headerGet(CLIENT_HEADER),
  );
  const ciRaw = headerGet(CI_HEADER);
  const isCi = ciRaw === "1" || ciRaw?.toLowerCase() === "true";
  return {
    surface,
    ...(surface_version ? { surfaceVersion: surface_version } : {}),
    isCi: !!isCi,
  };
}
