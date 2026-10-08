import type { TraceTopicName } from "../repositories/trace-topic-names.repository.ts";

/** The rows a store writes to move from `previous` to `next`: changed topics, and removals. */
export function topicNameChanges({
  previous,
  next,
}: {
  previous: readonly TraceTopicName[];
  next: readonly TraceTopicName[];
}): { topic: TraceTopicName; removed: boolean }[] {
  const before = new Map(previous.map((topic) => [topic.id, topic]));
  const nextIds = new Set(next.map((topic) => topic.id));
  const changed = next
    .filter((topic) => {
      const old = before.get(topic.id);
      return !old || old.name !== topic.name || old.parentId !== topic.parentId;
    })
    .map((topic) => ({ topic, removed: false }));
  const removed = previous
    .filter((topic) => !nextIds.has(topic.id))
    .map((topic) => ({ topic, removed: true }));
  return [...changed, ...removed];
}
