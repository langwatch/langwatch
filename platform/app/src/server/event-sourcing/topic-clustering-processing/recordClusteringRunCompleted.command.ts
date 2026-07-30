import type { EmittedEvent } from "@langwatch/event-sourcing";
import { topicClusteringEvents } from "./events";
import type { RunCompletedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function recordClusteringRunCompleted(
  input: RunCompletedData,
): Promise<readonly EmittedEvent<typeof topicClusteringEvents>[]> {
  return [{ type: "runCompleted", data: input }];
}
