import type { EmittedEvent } from "@langwatch/event-sourcing";
import { metricProcessingEvents } from "./events";
import type { CanonicalMetricDataPoint } from "./schema";

/**
 * The trust boundary (ADR-105 decision 7). Canonicalisation, redaction and
 * identity hashing all happen upstream in `prepareMetricDataPoints.ts`, so
 * this command is a pure function of its input.
 */
export async function recordDataPoint(
  input: CanonicalMetricDataPoint,
): Promise<readonly EmittedEvent<typeof metricProcessingEvents>[]> {
  return [{ type: "dataPointReceived", data: input }];
}
