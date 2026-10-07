import { ClickHouseTraceFacetRegistryRepository } from "../../../repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import { TraceQueryEvaluationScopeService } from "../../trace-query-evaluation-scope.service.ts";
import { TraceQueryEvaluationService } from "../../trace-query-evaluation.service.ts";
import { TraceQueryFieldsService } from "../../trace-query-fields.service.ts";
import { TraceQueryTranslationService } from "../../trace-query-translation.service.ts";

/** The trace query services over the ClickHouse facet registry, composed as `trace.app.ts` does. */
const facetRegistry = ClickHouseTraceFacetRegistryRepository.create();

/** Every facet the ClickHouse registry offers, for tests that walk them all. */
export const traceFacetRegistry = facetRegistry.getCatalog().registry;
export const traceQueryFields = TraceQueryFieldsService.create({ facetRegistry });
export const traceQueryEvaluationScope = TraceQueryEvaluationScopeService.create({
  fields: traceQueryFields,
});
export const traceQueryTranslation = TraceQueryTranslationService.create({
  fields: traceQueryFields,
  evaluationScope: traceQueryEvaluationScope,
});
export const traceQueryEvaluation = TraceQueryEvaluationService.create({
  fields: traceQueryFields,
  evaluationScope: traceQueryEvaluationScope,
  translation: traceQueryTranslation,
});
