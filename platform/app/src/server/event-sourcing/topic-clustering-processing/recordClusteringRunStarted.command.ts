import type { EmittedEvent } from "@langwatch/event-sourcing";
import { topicClusteringEvents } from "./events";
import type { RunStartedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function recordClusteringRunStarted(
  input: RunStartedData,
): Promise<readonly EmittedEvent<typeof topicClusteringEvents>[]> {
  return [{ type: "runStarted", data: input }];
}
