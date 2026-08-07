/**
 * The filter vocabulary the gateway spend reads share.
 *
 * Both reads answer questions about the same rows, so a filter that exists
 * on one and not the other makes the surface unusable for its actual job: a
 * reconciliation checksums the rollups and then diffs the events, and it can
 * only do that if it can ask both the same question. One module owns the
 * query shape, the domain type and the SQL so the two cannot drift, and a
 * unit test pins that both routes mount this shape.
 *
 * Project, team and external-id filters are deliberately NOT here. They name
 * things that live in Postgres and are resolved to tenant ids and virtual key
 * ids before a query is built, so ClickHouse only ever sees ids it stores.
 */

import { z } from "zod";

import type { SpendEventStatus } from "./spendEvents.clickhouse.repository";

/** Legacy filter vocabulary ("success"/"error") maps onto the lifecycle
 *  statuses so pre-pipeline API clients keep working. */
export function normalizeStatusFilter(
  status: string,
): SpendEventStatus | undefined {
  if (status === "success") return "confirmed";
  if (status === "error") return "failed";
  if (status === "") return undefined;
  if (
    status === "admitted" ||
    status === "confirmed" ||
    status === "failed" ||
    status === "settled"
  ) {
    return status;
  }
  // An unknown non-empty token is a caller bug: throwing beats silently
  // dropping the filter on a surface that feeds downstream billers.
  throw new Error(
    `Unknown spend status filter "${status}"; expected success, error, admitted, confirmed, failed, or settled`,
  );
}

/** A metadata predicate: the caller's own key, and the values that match. */
export interface SpendMetadataFilter {
  key: string;
  /** Any of these matches. Repeating a key in the query widens it. */
  values: string[];
}

export interface SpendFilters {
  virtualKeyIds?: string[];
  endUserIds?: string[];
  principalUserIds?: string[];
  models?: string[];
  providerKeys?: string[];
  requestTypes?: string[];
  labels?: string[];
  metadata?: SpendMetadataFilter[];
  status?: string;
}

/**
 * A filter the caller may repeat. Hono hands a query parameter back as a
 * string when it appears once and an array when it appears more than once,
 * so a schema that accepted only one of those shapes would reject the
 * commoner half of the traffic.
 */
function repeatable(
  inner: z.ZodType<string, z.ZodTypeDef, string>,
): z.ZodType<string[], z.ZodTypeDef, string | string[]> {
  return z
    .union([inner, z.array(inner)])
    .transform((value): string[] => (Array.isArray(value) ? value : [value]));
}

const id = z.string().min(1).max(100);
const longId = z.string().min(1).max(256);

/**
 * `key:value`, split on the FIRST colon so a value may contain one. The key
 * cannot: a metadata key with a colon in it is unaddressable here, which is
 * a limit worth naming rather than a shape worth guessing at.
 */
const metadataPair = z
  .string()
  .min(3)
  .max(640)
  .refine((raw) => raw.includes(":") && !raw.startsWith(":"), {
    message: "metadata must be written key:value",
  });

/**
 * The query-parameter shape both spend reads mount. Spread into each route's
 * schema rather than extended from it, because the two carry different
 * windows, cursors and page sizes around this common core.
 */
export const spendFilterQueryShape = {
  project_id: repeatable(id).optional(),
  team_id: repeatable(id).optional(),
  external_id: repeatable(z.string().min(1).max(200)).optional(),
  virtual_key_id: repeatable(id).optional(),
  end_user_id: repeatable(longId).optional(),
  principal_user_id: repeatable(id).optional(),
  model: repeatable(z.string().min(1).max(200)).optional(),
  provider_key: repeatable(id).optional(),
  request_type: repeatable(z.string().min(1).max(50)).optional(),
  label: repeatable(z.string().min(1).max(200)).optional(),
  metadata: repeatable(metadataPair).optional(),
  status: z
    .enum(["success", "error", "admitted", "confirmed", "failed", "settled"])
    .optional(),
} as const;

/** The parsed shape of {@link spendFilterQueryShape}. */
export type SpendFilterQuery = z.infer<
  z.ZodObject<typeof spendFilterQueryShape>
>;

/**
 * Group repeated pairs by key: repeating a key widens that key (any of the
 * values match), while naming two keys narrows (both must match). Treating
 * a repeated key as another AND would make `tier:gold` plus `tier:silver`
 * match nothing at all, which reads as "no such spend" rather than as the
 * caller having asked an impossible question.
 */
export function parseMetadataFilters(raw: string[]): SpendMetadataFilter[] {
  const byKey = new Map<string, string[]>();
  for (const pair of raw) {
    const separator = pair.indexOf(":");
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const existing = byKey.get(key);
    if (existing) existing.push(value);
    else byKey.set(key, [value]);
  }
  return [...byKey].map(([key, values]) => ({ key, values }));
}

/**
 * Both lists must hold for a row to match, so an absent list is "no opinion"
 * and two present lists intersect. Naming a key directly and naming it by the
 * customer's own external id is one narrowing expressed twice, and naming two
 * different keys that way is a question with no answer, not a wider one.
 */
export function intersectIds(
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
export function spendFiltersFromQuery(
  query: SpendFilterQuery,
  overrides?: { virtualKeyIds?: string[] },
): SpendFilters {
  return {
    virtualKeyIds: intersectIds(query.virtual_key_id, overrides?.virtualKeyIds),
    endUserIds: query.end_user_id,
    principalUserIds: query.principal_user_id,
    models: query.model,
    providerKeys: query.provider_key,
    requestTypes: query.request_type,
    labels: query.label,
    metadata:
      query.metadata === undefined
        ? undefined
        : parseMetadataFilters(query.metadata),
    status: query.status,
  };
}

/**
 * The same vocabulary for callers that already speak in structured values
 * rather than query strings, so the tRPC surface behind the Billing events
 * screen narrows exactly the way the REST reads do.
 */
export const spendFiltersSchema = z.object({
  virtualKeyIds: z.array(id).optional(),
  endUserIds: z.array(longId).optional(),
  principalUserIds: z.array(id).optional(),
  models: z.array(z.string().min(1).max(200)).optional(),
  providerKeys: z.array(id).optional(),
  requestTypes: z.array(z.string().min(1).max(50)).optional(),
  labels: z.array(z.string().min(1).max(200)).optional(),
  metadata: z
    .array(
      z.object({
        key: z.string().min(1).max(128),
        values: z.array(z.string().max(512)).min(1),
      }),
    )
    .optional(),
  status: z
    .enum(["success", "error", "admitted", "confirmed", "failed", "settled"])
    .optional(),
}) satisfies z.ZodType<SpendFilters, z.ZodTypeDef, unknown>;

const IN_COLUMNS: ReadonlyArray<readonly [keyof SpendFilters, string]> = [
  ["virtualKeyIds", "VirtualKeyId"],
  ["endUserIds", "EndUserId"],
  ["principalUserIds", "PrincipalUserId"],
  ["models", "Model"],
  ["providerKeys", "ProviderKey"],
  ["requestTypes", "RequestType"],
];

/**
 * Render the filters as bare ClickHouse predicates, binding a placeholder only
 * for the filters actually present so a query never references a parameter it
 * did not supply. Bare, because callers differ in how they join: one appends
 * to a fixed WHERE, another joins a condition list.
 *
 * A filter that is PRESENT but empty still emits its predicate. That is the
 * whole point: a team filter naming a team with no projects, or an external
 * id matching no key, must answer nothing rather than collapse into an
 * absent predicate and hand back the organization's entire spend under a
 * narrowing the caller asked for.
 */
export function buildSpendFilterClauses({
  filters,
}: {
  filters: SpendFilters;
}): { clauses: string[]; params: Record<string, unknown> } {
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

  const status =
    filters.status !== undefined
      ? normalizeStatusFilter(filters.status)
      : undefined;
  if (status !== undefined) {
    clauses.push("Status = {status:String}");
    params.status = status;
  }

  return { clauses, params };
}
