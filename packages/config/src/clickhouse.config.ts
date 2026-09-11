import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config.ts";

/**
 * One organization whose data lives on its own ClickHouse server.
 *
 * These used to be a variable per customer,
 * `CLICKHOUSE_URL__<label>__<organizationId>`, whose name carried the id — so
 * `packages/secrets/keys.json`, which classifies by exact key and does no
 * prefix matching, could not name a single one of them. Every one carried
 * `user:password@host` past the classifier: `haven env` printed it in full and
 * the vault could not resolve it by name, and the prefix scan that read them
 * was the one route around `secrets-through-source`. One key holds the whole
 * family now, and it is classified once as a composite secret.
 */
const clickhousePrivateRouteSchema = z.object({
  organizationId: z.string().min(1),
  url: z.string().min(1),
});

/** One organization's own ClickHouse server. */
export type ClickHousePrivateRoute = z.infer<typeof clickhousePrivateRouteSchema>;

const clickhousePrivateRoutesSchema = z.array(clickhousePrivateRouteSchema);

/** A declared route this process refused, and why, for the caller to report. */
export interface SkippedClickHousePrivateRoute {
  readonly index: number;
  readonly reason: "invalid_shape";
}

export interface ClickHousePrivateRoutes {
  readonly routes: readonly ClickHousePrivateRoute[];
  readonly skipped: readonly SkippedClickHousePrivateRoute[];
}

/**
 * Reads `CLICKHOUSE_PRIVATE_ROUTES` into the routes a process may reach.
 *
 * A malformed ENTRY is skipped and reported rather than raised: one customer's
 * bad entry must not stop the process that serves everyone else. A DUPLICATE
 * organization id throws, because two servers for one tenant is a question
 * this process cannot answer, and answering it wrong reads or writes their
 * data on somebody else's server. Malformed JSON throws for the same reason:
 * silently reading it as "no private routes" sends every private tenant to the
 * shared server, which is the failure this whole family exists to prevent.
 */
export function parseClickHousePrivateRoutes(raw: string | undefined): ClickHousePrivateRoutes {
  const value = raw?.trim();
  if (!value) return { routes: [], skipped: [] };

  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch (error) {
    throw new Error(
      "CLICKHOUSE_PRIVATE_ROUTES is not JSON. Refusing to start with every private tenant " +
        "routed to the shared server.",
      { cause: error },
    );
  }

  if (!Array.isArray(decoded)) {
    throw new Error(
      'CLICKHOUSE_PRIVATE_ROUTES must be a JSON array of { "organizationId", "url" } entries.',
    );
  }

  const routes: ClickHousePrivateRoute[] = [];
  const skipped: SkippedClickHousePrivateRoute[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of decoded.entries()) {
    const parsed = clickhousePrivateRouteSchema.safeParse(entry);
    if (!parsed.success) {
      skipped.push({ index, reason: "invalid_shape" });
      continue;
    }
    if (seen.has(parsed.data.organizationId)) {
      throw new Error(
        `Two ClickHouse routes are configured for organisation "${parsed.data.organizationId}". ` +
          "Refusing to guess which server holds their data.",
      );
    }
    seen.add(parsed.data.organizationId);
    routes.push(parsed.data);
  }

  return { routes, skipped };
}

/** The whole schema, for a caller that validates the variable ahead of boot. */
export const clickhousePrivateRoutesValueSchema = clickhousePrivateRoutesSchema;

/**
 * The endpoints a process that reads or writes ClickHouse binds: the shared
 * server, and the organizations that sit on their own. A caller that needs the
 * operator-only EXPLAIN identity or the restricted LangWatchQL identity
 * declares those leaves itself, beside these.
 */
export const clickhouseConfigDefinition = RuntimeConfig.define({
  url: Config.value(z.string().optional(), { env: "CLICKHOUSE_URL" }),
  privateRoutes: Config.value(z.string().optional(), { env: "CLICKHOUSE_PRIVATE_ROUTES" }),
});
