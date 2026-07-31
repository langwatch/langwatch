import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { topicClusteringEvents } from "./events";
import type { RequestedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function requestClustering(
  input: RequestedData,
): Promise<readonly EmittedEvent<typeof topicClusteringEvents>[]> {
  return [{ type: "requested", data: input }];
}
