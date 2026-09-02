import { z } from "zod";

/**
 * The per-organization S3 accounts a deployment declares, one variable each:
 *
 *     DATAPLANE_S3__<label>__<organizationId>={"endpoint":…,"bucket":…,
 *                                              "accessKeyId":…,"secretAccessKey":…}
 *
 * The `<label>` is a human-readable customer name and carries no meaning; the
 * last `__`-separated segment is the organization id the route is keyed by.
 * Nothing but the variable NAME carries that id, which is why this is read off
 * the environment directly rather than declared as a config leaf: a
 * declarative projection can only name variables it knows in advance.
 *
 * Every process that addresses a tenant's own bucket resolves it here, so a
 * route parsed by one is the route every other one parses. Two processes
 * splitting `<label>__<organizationId>` differently would write a customer's
 * objects where they cannot read them, and neither side would report an error.
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
 * Reads every `DATAPLANE_S3__*` variable in `source` into a routing table.
 *
 * A malformed entry is SKIPPED and reported rather than raised: one customer's
 * bad JSON must not stop the process that serves everyone else. A DUPLICATE
 * organization id THROWS, because two routes for one tenant is a question this
 * process cannot answer, and answering it wrong addresses their data somewhere
 * they cannot read it.
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
 * The organization id a variable name addresses.
 *
 * The LAST `__` separates the label from the id, so a label may itself contain
 * one. A name with no separator at all is taken whole, which is how a
 * deployment that omitted the label still addresses the organization it meant.
 */
function organizationIdOf(envVar: string): string {
  const suffix = envVar.slice(DATAPLANE_S3_ENV_PREFIX.length);
  const separator = suffix.lastIndexOf("__");
  return separator >= 0 ? suffix.slice(separator + 2) : suffix;
}
