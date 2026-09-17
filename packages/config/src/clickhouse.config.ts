import { z } from "zod";

import { Config, RuntimeConfig } from "./runtime-config.ts";

/**
 * One organization's data on its own ClickHouse server. Was per-customer variables with ids in
 * names (`CLICKHOUSE_URL__<label>__<organizationId>`), which the secrets classifier couldn't
 * match. Now one key for the whole family, classified once as a composite secret.
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
 * Parse `CLICKHOUSE_PRIVATE_ROUTES` into reachable routes. Malformed entries are skipped;
 * duplicate org ids and malformed JSON throw (silently treating them as "no private routes"
 * sends every private tenant to the shared server, which this family prevents).
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

/** The older per-customer form, as the caller's own parser already read it. */
export interface PerCustomerClickHouseRoute {
  readonly organizationId: string;
  readonly url: string;
}

/** The per-customer spelling this key replaces; named in what it reports. */
const LEGACY_ROUTE_ENV_PREFIX = "CLICKHOUSE_URL__";

/** Somewhere a route this process refused can be said out loud. */
export interface ClickHouseRouteReport {
  warn(attributes: Record<string, unknown>, message: string): void;
}

/**
 * Both spellings of "this organization is on its own server", in one table.
 * The per-customer form puts the organization in the NAME, where no classifier
 * can mask it. Declared twice and differently, the boot refuses.
 */
export function mergeClickHousePrivateRoutes(input: {
  declared: string | undefined;
  perCustomer: readonly PerCustomerClickHouseRoute[];
  report: ClickHouseRouteReport;
}): readonly ClickHousePrivateRoute[] {
  const declared = parseClickHousePrivateRoutes(input.declared);
  for (const skipped of declared.skipped) {
    input.report.warn(
      { envVar: "CLICKHOUSE_PRIVATE_ROUTES", index: skipped.index, reason: skipped.reason },
      "Ignoring an entry in CLICKHOUSE_PRIVATE_ROUTES that is not an organization id and a url",
    );
  }

  const merged = new Map<string, ClickHousePrivateRoute>();
  for (const route of declared.routes) merged.set(route.organizationId, route);

  for (const route of input.perCustomer) {
    const already = merged.get(route.organizationId);
    if (already !== undefined && already.url !== route.url) {
      throw new Error(
        `Organization "${route.organizationId}" has one ClickHouse route in CLICKHOUSE_PRIVATE_ROUTES and a different one in a ${LEGACY_ROUTE_ENV_PREFIX} variable. ` +
          "Refusing to guess which server holds their data.",
      );
    }
    if (already === undefined) {
      merged.set(route.organizationId, { organizationId: route.organizationId, url: route.url });
    }
    input.report.warn(
      { envVarPrefix: LEGACY_ROUTE_ENV_PREFIX, organizationId: route.organizationId },
      `A ClickHouse route is declared in a ${LEGACY_ROUTE_ENV_PREFIX} variable, which carries the organization in its NAME and so cannot be masked; move it into CLICKHOUSE_PRIVATE_ROUTES`,
    );
  }

  return [...merged.values()];
}

/**
 * The endpoints a process that reads or writes ClickHouse binds: the shared
 * server, and organizations that sit on their own. A caller needing the
 * EXPLAIN or LangWatchQL identity declares those leaves itself, beside these.
 */
export const clickhouseConfigDefinition = RuntimeConfig.define({
  url: Config.value(z.string().optional(), { env: "CLICKHOUSE_URL" }),
  privateRoutes: Config.value(z.string().optional(), { env: "CLICKHOUSE_PRIVATE_ROUTES" }),
});
