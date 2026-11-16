import type { ResolvedInstantEvalRun } from "@langwatch/trace-contract";

import { ClickHouseTraceFacetRegistryRepository } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import {
  createFacetFilterResolver,
  type FacetFilterResolver,
} from "../../../features/facet/rules/trace-facet-filter.rules.ts";
import {
  findHiddenOriginFilters,
  type TraceFilterCompile,
  traceFilterCompileOf,
} from "../../../features/query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";
import { TraceQueryEvaluationService } from "../../../features/query/services/trace-query-evaluation.service.ts";
import { TraceQueryFieldsService } from "../../../features/query/services/trace-query-fields.service.ts";
import { TraceQueryTranslationService } from "../../../features/query/services/trace-query-translation.service.ts";
import type { TraceFacetFilter } from "../../../repositories/trace-list.repository.ts";

/** The trace query services over the ClickHouse facet registry, composed as `trace.app.ts` does. */
const facetRegistry = ClickHouseTraceFacetRegistryRepository.create();

/** Every facet the ClickHouse registry offers, for tests that walk them all. */
export const traceFacetRegistry = facetRegistry.getCatalog().registry;
export const traceQueryFields = TraceQueryFieldsService.create({ facetRegistry });
export const traceQueryTranslation = TraceQueryTranslationService.create({
  fields: traceQueryFields,
});
export const traceQueryEvaluation = TraceQueryEvaluationService.create({
  fields: traceQueryFields,
  translation: traceQueryTranslation,
});

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
        present: traceQueryTranslation.translateFilter({ queryText, timeRange }) !== null,
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
