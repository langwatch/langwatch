import type { z } from "zod";
import {
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./contributions";

export const contributeSpanFactsCommandDataSchema = spanFactsContributionSchema;
export type ContributeSpanFactsCommandData = z.infer<
  typeof contributeSpanFactsCommandDataSchema
>;

export const contributeLogFactsCommandDataSchema = logFactsContributionSchema;
export type ContributeLogFactsCommandData = z.infer<
  typeof contributeLogFactsCommandDataSchema
>;

export const contributeMetricFactsCommandDataSchema =
  metricFactsContributionSchema;
export type ContributeMetricFactsCommandData = z.infer<
  typeof contributeMetricFactsCommandDataSchema
>;
