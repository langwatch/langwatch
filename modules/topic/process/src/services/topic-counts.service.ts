import type { NamedTopicCounts, Topic, TopicProjectInput } from "@langwatch/topic-contract";
import {
  topicCountsResultSchema,
  type TraceApi,
  type traceFilterInputSchema,
} from "@langwatch/trace-contract";
import type { z } from "zod";

type TopicCountsInput = z.infer<typeof traceFilterInputSchema>;
type Bucket = { key: string; count: number };

/**
 * The topic filter's counts: trace counts traces per topic id, topic names them.
 * A bucket whose topic is gone drops out, as `traces.getTopicCounts` did.
 */
export class TopicCountsService {
  static create(options: {
    traces: Pick<TraceApi, "readTopicCounts">;
    topics: { getAll(input: TopicProjectInput): Promise<Topic[]> };
  }): TopicCountsService {
    return new TopicCountsService(options.traces, options.topics);
  }

  private constructor(
    private readonly traces: Pick<TraceApi, "readTopicCounts">,
    private readonly topics: { getAll(input: TopicProjectInput): Promise<Topic[]> },
  ) {}

  async getTopicCounts(input: TopicCountsInput): Promise<NamedTopicCounts> {
    const counts = topicCountsResultSchema.parse(await this.traces.readTopicCounts(input));
    const byId = new Map(
      (await this.topics.getAll({ projectId: input.projectId })).map((topic) => [topic.id, topic]),
    );
    const named = (buckets: Bucket[]) =>
      buckets.flatMap((bucket) => {
        const topic = byId.get(bucket.key);
        return topic ? [{ bucket, topic }] : [];
      });

    return {
      topicCounts: named(counts.topicCounts).map(({ bucket, topic }) => ({
        id: bucket.key,
        name: topic.name,
        count: bucket.count,
      })),
      subtopicCounts: named(counts.subtopicCounts).map(({ bucket, topic }) => ({
        id: bucket.key,
        name: topic.name,
        count: bucket.count,
        parentId: topic.parentId,
      })),
    };
  }
}
