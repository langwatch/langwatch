import type { EmittedEvent } from "@langwatch/event-sourcing";
import { topicClusteringEvents } from "./events";
import type { TopicsRecordedData } from "./schema";

/** The trust boundary (ADR-105 decision 7): a pure function of its input. */
export async function recordTopics(
  input: TopicsRecordedData,
): Promise<readonly EmittedEvent<typeof topicClusteringEvents>[]> {
  return [{ type: "topicsRecorded", data: input }];
}
