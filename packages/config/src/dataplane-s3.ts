import { z } from "zod";

/**
 * Per-organization S3 accounts: `DATAPLANE_S3__<label>__<organizationId>={…}`. The last segment
 * is the org id (keyed by variable name, not config leaf). All processes must parse it the same
 * way or customer data gets misaddressed.
 */

const dataplaneS3RouteSchema = z.object({
  endpoint: z.string().min(1),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
});

/** One organization's own S3 account. */
export type DataplaneS3Route = z.infer<typeof dataplaneS3RouteSchema>;

/** Why a declared variable did not become a route. */
export type SkippedDataplaneS3Route = {
  readonly envVar: string;
  readonly reason: "not_json" | "invalid_shape";
};

export type DataplaneS3RoutingTable = {
  readonly routes: ReadonlyMap<string, DataplaneS3Route>;
  readonly skipped: readonly SkippedDataplaneS3Route[];
};

export const DATAPLANE_S3_ENV_PREFIX = "DATAPLANE_S3__";

/**
 * Parse `DATAPLANE_S3__*` variables into a routing table. Malformed entries are skipped
 * (one customer's bad JSON must not stop the whole process). Duplicate org ids throw
 * (two routes for one tenant misaddresses data).
 */
export function parseDataplaneS3RoutingTable(
  source: Readonly<Record<string, unknown>>,
): DataplaneS3RoutingTable {
  const routes = new Map<string, DataplaneS3Route>();
  const skipped: SkippedDataplaneS3Route[] = [];

  for (const [envVar, raw] of Object.entries(source)) {
    if (!envVar.startsWith(DATAPLANE_S3_ENV_PREFIX) || typeof raw !== "string" || !raw) continue;

    const organizationId = organizationIdOf(envVar);
    if (!organizationId) continue;

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      skipped.push({ envVar, reason: "not_json" });
      continue;
    }

    const parsed = dataplaneS3RouteSchema.safeParse(decoded);
    if (!parsed.success) {
      skipped.push({ envVar, reason: "invalid_shape" });
      continue;
    }

    if (routes.has(organizationId)) {
      throw new Error(
        `Duplicate private S3 config for organization "${organizationId}": "${envVar}" conflicts with an earlier definition.`,
      );
    }
    routes.set(organizationId, parsed.data);
  }

  return { routes, skipped };
}

/**
 * The organization id a variable name addresses. The LAST `__` separates the
 * label from the id, so a label may itself contain one. No separator at all
 * means the whole suffix is taken as the id.
 */
function organizationIdOf(envVar: string): string {
  const suffix = envVar.slice(DATAPLANE_S3_ENV_PREFIX.length);
  const separator = suffix.lastIndexOf("__");
  return separator >= 0 ? suffix.slice(separator + 2) : suffix;
}
