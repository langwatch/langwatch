/**
 * Filter vocabulary shared by both gateway spend reads: one module owns the
 * query shape, domain type and SQL. Project/team/external-id filters are absent —
 * those resolve to Postgres ids before a query is built.
 */

import {
  SPEND_STATUS_FILTERS,
  type SpendEventStatus,
  type SpendFilterQuery,
  type SpendFilters,
  type SpendMetadataFilter,
} from "@langwatch/gateway-contract";

/**
 * The pre-pipeline spellings, and the lifecycle status each one means. A Map
 * rather than an object literal because the lookup key is caller data, and an
 * object would answer `constructor` with a function.
 */
const LEGACY_STATUS_ALIASES = new Map<string, SpendEventStatus>([
  ["success", "confirmed"],
  ["error", "failed"],
]);

const IN_COLUMNS: readonly (readonly [keyof SpendFilters, string])[] = [
  ["virtualKeyIds", "VirtualKeyId"],
  ["endUserIds", "EndUserId"],
  ["principalUserIds", "PrincipalUserId"],
  ["models", "Model"],
  ["providerKeys", "ProviderKey"],
  ["requestTypes", "RequestType"],
];

/**
 * Status a filter token names, DERIVED from {@link SPEND_STATUS_FILTERS}
 * rather than restated — restating risks a new tuple entry passing
 * validation here and then throwing downstream as a 500.
 */
export function normalizeStatusFilter(status: string): SpendEventStatus | undefined {
  if (status === "") return undefined;
  const alias = LEGACY_STATUS_ALIASES.get(status);
  if (alias !== undefined) return alias;
  if ((SPEND_STATUS_FILTERS as readonly string[]).includes(status)) {
    // Everything in the tuple that is not an alias IS a lifecycle status, and
    // the aliases are answered above.
    return status as SpendEventStatus;
  }
  // An unknown non-empty token is a caller bug: throwing beats silently
  // dropping the filter on a surface that feeds downstream billers.
  throw new Error(
    `Unknown spend status filter "${status}"; expected ${SPEND_STATUS_FILTERS.join(", ")}`,
  );
}

/**
 * Status a filter token names, DERIVED from {@link SPEND_STATUS_FILTERS}
 * rather than restated — restating risks a new tuple entry passing here
 * and throwing downstream instead, turning a validated request into a 500.
 */
export function parseMetadataFilters(raw: string[]): SpendMetadataFilter[] {
  const byKey = new Map<string, string[]>();
  for (const pair of raw) {
    const separator = pair.indexOf(":");
    // The same rule {@link metadataPair} enforces, restated for callers that
    // reach this function without it. Slicing on an absent colon is silently
    // wrong rather than empty: `"tier"` has `indexOf` -1, so the key becomes
    // `"tie"` and the value the whole token, and the caller reads spend for a
    // filter nobody wrote.
    if (separator <= 0 || separator === pair.length - 1) {
      throw new Error(`metadata must be written key:value, with both sides non-empty: "${pair}"`);
    }
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const existing = byKey.get(key);
    if (existing) existing.push(value);
    else byKey.set(key, [value]);
  }
  return [...byKey].map(([key, values]) => ({ key, values }));
}

/**
 * Both lists must hold to match: absent is "no opinion", two present lists
 * intersect. Naming a key directly and via external id is one narrowing said
 * twice; naming two different keys that way is unanswerable, not wider.
 */
export function computeIdIntersection(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const inB = new Set(b);
  return a.filter((value) => inB.has(value));
}

/**
 * The subset of a parsed query that ClickHouse can answer directly. The
 * Postgres-resolved filters (project, team, external id) are applied by the
 * caller before this runs.
 */
export function spendFiltersFromQuery({
  query,
  overrides,
}: {
  query: SpendFilterQuery;
  overrides?: { virtualKeyIds?: string[] };
}): SpendFilters {
  return {
    virtualKeyIds: computeIdIntersection(query.virtual_key_id, overrides?.virtualKeyIds),
    endUserIds: query.end_user_id,
    principalUserIds: query.principal_user_id,
    models: query.model,
    providerKeys: query.provider_key,
    requestTypes: query.request_type,
    labels: query.label,
    metadata: query.metadata === undefined ? undefined : parseMetadataFilters(query.metadata),
    status: query.status,
  };
}

/**
 * Bare ClickHouse predicates, one per filter actually present (callers join
 * differently). A present-but-empty filter still emits its predicate — otherwise
 * it hands back the org's entire spend under a narrowing the caller asked for.
 */
export function buildSpendFilterClauses({ filters }: { filters: SpendFilters }): {
  clauses: string[];
  params: Record<string, unknown>;
} {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  for (const [field, column] of IN_COLUMNS) {
    const values = filters[field] as string[] | undefined;
    if (values === undefined) continue;
    clauses.push(`${column} IN {${field}:Array(String)}`);
    params[field] = values;
  }

  if (filters.labels !== undefined) {
    clauses.push("hasAny(Labels, {labels:Array(String)})");
    params.labels = filters.labels;
  }

  filters.metadata?.forEach((filter, index) => {
    clauses.push(
      `MetadataMap[{metadataKey${index}:String}] IN {metadataValues${index}:Array(String)}`,
    );
    params[`metadataKey${index}`] = filter.key;
    params[`metadataValues${index}`] = filter.values;
  });

  const status = filters.status !== undefined ? normalizeStatusFilter(filters.status) : undefined;
  if (status !== undefined) {
    clauses.push("Status = {status:String}");
    params.status = status;
  }

  return { clauses, params };
}
