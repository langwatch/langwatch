type Counted = { name: string; count: number };

export type TopicSelection = { topics: string[]; subtopics: string[] };

/** A comma-separated query value as a list; absent or empty reads as none. */
export function readListParam(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? value.split(",") : [];
}

/** A list as a query value; an empty list clears the parameter. */
export function toListParam(list: string[]): string | undefined {
  return list.length > 0 ? list.join(",") : undefined;
}

/** Unticking a topic also unticks the subtopics filed under it. */
export function toggleTopic({
  selection,
  topicId,
  checked,
  subtopicCounts,
}: {
  selection: TopicSelection;
  topicId: string;
  checked: boolean;
  subtopicCounts: { id: string; parentId?: string | null }[] | undefined;
}): TopicSelection {
  if (checked) return { ...selection, topics: [...selection.topics, topicId] };
  const topics = selection.topics.filter((t) => t !== topicId);
  if (!subtopicCounts) return { ...selection, topics };
  const children = subtopicCounts.filter((s) => s.parentId === topicId).map((s) => s.id);
  return { topics, subtopics: selection.subtopics.filter((t) => !children.includes(t)) };
}

export function toggleSubtopic({
  subtopics,
  subtopicId,
  checked,
}: {
  subtopics: string[];
  subtopicId: string;
  checked: boolean;
}): string[] {
  return checked ? [...subtopics, subtopicId] : subtopics.filter((t) => t !== subtopicId);
}

/** Most counted first, then by name. */
export function orderByCountThenName<T extends Counted>(items: readonly T[]): T[] {
  return [...items]
    .toSorted((a, b) => (a.name > b.name ? 1 : -1))
    .toSorted((a, b) => (a.count > b.count ? -1 : 1));
}
