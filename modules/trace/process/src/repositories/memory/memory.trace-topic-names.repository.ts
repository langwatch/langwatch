import { TraceTopicNamesReadRepository } from "../../features/topic/repositories/trace-topic-names.repository.ts";

/** A topic as a test seeds it, with the project that owns it. */
type SeededTopic = { projectId: string; id: string; name: string };

/** Topic's shared `Topic` rows in memory, seeded by a test; trace writes none. */
export class MemoryTraceTopicNamesRepository extends TraceTopicNamesReadRepository {
  static create({
    topics = [],
  }: { topics?: readonly SeededTopic[] } = {}): MemoryTraceTopicNamesRepository {
    return new MemoryTraceTopicNamesRepository(topics);
  }

  private constructor(private readonly topics: readonly SeededTopic[]) {
    super();
  }

  async findNamesByIds({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<Map<string, string>> {
    const wanted = new Set(ids);
    return new Map(
      this.topics
        .filter((topic) => topic.projectId === projectId && wanted.has(topic.id))
        .map((topic) => [topic.id, topic.name]),
    );
  }
}
