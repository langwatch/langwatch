import { ClickHouseTraceFacetRegistryRepository } from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import { TraceQueryEvaluationService } from "../../../features/query/services/trace-query-evaluation.service.ts";
import { TraceQueryFieldsService } from "../../../features/query/services/trace-query-fields.service.ts";
import { TraceQueryTranslationService } from "../../../features/query/services/trace-query-translation.service.ts";

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
