import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { traceEvents } from "./events";
import { isValidMetricCorrelation, type MetricCorrelation } from "./schema";

/** An all-zero or malformed trace/span id is a sentinel, not a correlation. */
export async function recordMetricCorrelation(
  input: MetricCorrelation,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return isValidMetricCorrelation(input)
    ? [{ type: "metricDataPointCorrelated", data: input }]
    : [];
}
