import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { topicClusteringEvents } from "./events";
import type { RunFailedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function recordClusteringRunFailed(
  input: RunFailedData,
): Promise<readonly EmittedEvent<typeof topicClusteringEvents>[]> {
  return [{ type: "runFailed", data: input }];
}
