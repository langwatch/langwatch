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
    ].includes(name),
};
