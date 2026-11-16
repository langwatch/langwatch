import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import type { ResolvedInstantEvalRun, TranslationContext } from "@langwatch/trace-contract";

import { ClickHouseTraceFacetRegistryRepository } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import {
  createFacetFilterResolver,
  type FacetFilterResolver,
} from "../../../features/facet/rules/trace-facet-filter.rules.ts";
import {
  checkTraceFilter,
  findHiddenOriginFilters,
  type TraceFilterCompile,
  traceFilterCompileOf,
  translateFilterConditions,
} from "../../../features/query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import { TraceQueryEvaluationService } from "../../../features/query/services/trace-query-evaluation.service.ts";
import { TraceQueryFieldsService } from "../../../features/query/services/trace-query-fields.service.ts";
import { traceSummaries } from "../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import type { TraceFacetFilter } from "../../../repositories/trace-list.repository.ts";

/** The trace query services over the ClickHouse facet registry, composed as `trace.app.ts` does. */
const facetRegistry = ClickHouseTraceFacetRegistryRepository.create();

/** Every facet the ClickHouse registry offers, for tests that walk them all. */
export const traceFacetRegistry = facetRegistry.getCatalog().registry;
export const traceQueryFields = TraceQueryFieldsService.create({ facetRegistry });
export const traceQueryEvaluation = TraceQueryEvaluationService.create({
  fields: traceQueryFields,
  check: (queryText) => checkTraceFilter({ queryText, fields: traceQueryFields }),
});

/**
 * A query compiled as the reads compile it, built into one single-tenant `trace_summaries` read:
 * the statement's text and the parameters the filter bound. Null for an empty query.
 */
export function builtTraceFilter({
  queryText,
  timeRange,
  evalRuns,
  searchContent,
  isHiddenAttribute,
  tenantId = "project_fixture",
}: {
  queryText: string;
  tenantId?: string;
  timeRange: { from: number; to: number };
  evalRuns?: readonly ResolvedInstantEvalRun[];
  searchContent?: boolean;
  isHiddenAttribute?: (key: string) => boolean;
}): {
  sql: string;
  /** The filter's own condition: the statement after its tenant predicate. */
  where: string;
  params: Record<string, unknown>;
  /** The values the built statement binds, by its own names. */
  bound: Record<string, unknown>;
} | null {
  const scope = tenantScope.single({ tenantId });
  const ctx: TranslationContext = {
    paramCounter: 0,
    nodeCount: 0,
    params: { timeFrom: timeRange.from, timeTo: timeRange.to },
    timeRange,
    ...(evalRuns ? { evalRuns } : {}),
  };
  const filter = translateFilterConditions({
    queryText,
    ctx,
    scope,
    fields: traceQueryFields,
    ...(searchContent === undefined ? {} : { searchContent }),
    ...(isHiddenAttribute ? { isHiddenAttribute } : {}),
  });
  if (filter.kind === "empty") return null;
  const statement = clickhouseRead({ scope })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .where(filter.where)
    .build();
  const prefix = "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String} AND ";
  return {
    sql: statement.sql,
    where: statement.sql.startsWith(prefix) ? statement.sql.slice(prefix.length) : statement.sql,
    params: ctx.params,
    bound: { ...statement.params },
  };
}

/** A query as the list reads take it: compiled inside each read for its scope, `hiddenOrigins` out
 * of it. */
export function traceFilterCompileFor({
  queryText,
  timeRange,
  evalRuns,
  hiddenOrigins = [],
}: {
  queryText: string;
  timeRange: { from: number; to: number };
  evalRuns?: readonly ResolvedInstantEvalRun[];
  hiddenOrigins?: readonly string[];
}): TraceFilterCompile {
  return traceFilterCompileOf({
    queryText,
    timeRange,
    fields: traceQueryFields,
    terms: findHiddenOriginFilters({ hiddenOrigins }),
    ...(evalRuns ? { evalRuns } : {}),
  });
}

/**
 * The sidebar's per-facet filters as `readFilteredFacets` composes them: as text for the raw
 * facet reads and compiled for the built ones, the hidden origins out of all but origin's own.
 */
export function traceFacetFilterResolverFor({
  query,
  timeRange,
  hiddenOrigins,
}: {
  query: string;
  timeRange: { from: number; to: number };
  hiddenOrigins: readonly string[];
}): FacetFilterResolver<TraceFacetFilter> {
  const facetFilterOf = ({
    queryText,
    present,
    hidden,
  }: {
    queryText: string;
    present: boolean;
    hidden: boolean;
  }): TraceFacetFilter | undefined =>
    present
      ? {
          queryText,
          compile: traceFilterCompileFor({
            queryText,
            timeRange,
            hiddenOrigins: hidden ? hiddenOrigins : [],
          }),
        }
      : undefined;
  return createFacetFilterResolver<TraceFacetFilter>({
    queryText: query,
    compile: (queryText) =>
      facetFilterOf({
        queryText,
        present: checkTraceFilter({ queryText, timeRange, fields: traceQueryFields }) === "compiled",
        hidden: false,
      }),
    hide: (filter) =>
      facetFilterOf({
        queryText: filter?.queryText ?? "",
        present: filter !== undefined || hiddenOrigins.length > 0,
        hidden: true,
      }),
  });
}
