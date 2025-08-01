/**
 * ts-to-zod configuration.
 *
 * @type {import("ts-to-zod").TsToZodConfig}
 */
module.exports = {
  input: "server/tracer/types.ts",
  output: "server/tracer/types.zod.ts",
  nameFilter: (name) =>
    ![
      "ElasticSearchSpan",
      "ElasticSearchInputOutput",
      "EvaluatorDefinition",
      "TraceCheckJob",
      "AnalyticsMetric",
      "NewDatasetEntries",
      "EvaluationRESTParams",
      "EvaluationRESTResult",
      "Json",
      "Literal",
      "DatasetSpan",
      "LLMModeTrace",
      "ReservedSpanParams",
      "SpanParams",
      "ReservedTraceMetadataMapping",
      "CustomMetadata",
      "TraceMetadata",
      "Event",
      "ElasticSearchEvent",
      "TrackEventRESTParamsValidator",
      "Trace",
      "ElasticSearchTrace",
      "CollectorRESTParams",
    ].includes(name),
};
