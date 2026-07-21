import {
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./contributions";

export const contributeSpanFactsCommandDataSchema = spanFactsContributionSchema;
export type ContributeSpanFactsCommandData = ReturnType<
  typeof contributeSpanFactsCommandDataSchema.parse
>;

export const contributeLogFactsCommandDataSchema = logFactsContributionSchema;
export type ContributeLogFactsCommandData = ReturnType<
  typeof contributeLogFactsCommandDataSchema.parse
>;

export const contributeMetricFactsCommandDataSchema =
  metricFactsContributionSchema;
export type ContributeMetricFactsCommandData = ReturnType<
  typeof contributeMetricFactsCommandDataSchema.parse
>;
