import type { EmittedEvent } from "@langwatch/event-sourcing";
import { simulationRunEvents } from "./events";
import type { MetricsRecordedData } from "./schema";

/** Deriving the values reads the trace-processing pipeline's stored spans, a
 * cross-pipeline read belonging to a command bridge outside this pipeline;
 * this command only decides the event once the values are already known. */
export async function recordMetrics(
  input: MetricsRecordedData,
): Promise<readonly EmittedEvent<typeof simulationRunEvents>[]> {
  return [{ type: "metricsRecorded", data: input }];
}
