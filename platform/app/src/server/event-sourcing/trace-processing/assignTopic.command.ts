import type { EmittedEvent } from "@langwatch/event-sourcing";
import type { traceEvents } from "./events";
import type { TopicAssignment } from "./schema";

export async function assignTopic(
  input: TopicAssignment,
): Promise<readonly EmittedEvent<typeof traceEvents>[]> {
  return [{ type: "topicAssigned", data: input }];
}
