import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
} from "./constants";
import {
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./contributions";

export const spanFactsContributedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: spanFactsContributionSchema,
});
export type SpanFactsContributedEvent = z.infer<
  typeof spanFactsContributedEventSchema
>;

export const logFactsContributedEventSchema = EventSchema.extend({
  type: z.literal(LOG_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: logFactsContributionSchema,
});
export type LogFactsContributedEvent = z.infer<
  typeof logFactsContributedEventSchema
>;

export const metricFactsContributedEventSchema = EventSchema.extend({
  type: z.literal(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: metricFactsContributionSchema,
});
export type MetricFactsContributedEvent = z.infer<
  typeof metricFactsContributedEventSchema
>;

export type CodingAgentProcessingEvent =
  | SpanFactsContributedEvent
  | LogFactsContributedEvent
  | MetricFactsContributedEvent;
