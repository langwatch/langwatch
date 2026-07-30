import { z } from "zod";
import { type TopicsRecordedData, topicModelEntrySchema } from "../schema";

/**
 * `topicModel` — the project's topic model, and its only writer
 * (specs/topic-clustering/topics-source-of-truth.feature). Topic ids pass
 * through unchanged so ClickHouse's `TopicId`/`SubTopicId` stay valid.
 *
 * A `replace` wipes topics it does not mention, and such a topic has no `asOf`
 * to compare against, so per-topic last-write-wins cannot decide the wipe.
 * `watermark` is the guard: only an accepted `replace` advances it, and an
 * event below it leaves content untouched, so a stale replay can never
 * resurrect a topic a newer replace discarded.
 */

const topicContentSchema = topicModelEntrySchema
  .omit({ firstRecordedAt: true })
  .extend({ asOf: z.number() });
type TopicContent = z.infer<typeof topicContentSchema>;

export const topicModelStateSchema = z.object({
  watermark: z.number(),
  topics: z.record(z.string(), topicContentSchema),
  /** "The earliest instant any event asserted this topic existed" is a fact
   * about the event stream, not about current content, so it accumulates as a
   * plain `min` and is never watermark-gated. */
  firstSeenAt: z.record(z.string(), z.number()),
});
export type TopicModelState = z.infer<typeof topicModelStateSchema>;

export function initTopicModelState(): TopicModelState {
  return { watermark: -Infinity, topics: {}, firstSeenAt: {} };
}

function withFirstSeenAt(
  firstSeenAt: TopicModelState["firstSeenAt"],
  data: TopicsRecordedData,
): TopicModelState["firstSeenAt"] {
  let next = firstSeenAt;
  for (const topic of data.topics) {
    const candidate = topic.firstRecordedAt ?? data.occurredAt;
    const current = next[topic.id];
    if (current === undefined || candidate < current) {
      if (next === firstSeenAt) next = { ...firstSeenAt };
      next[topic.id] = candidate;
    }
  }
  return next;
}

export function applyTopicsRecorded(
  state: TopicModelState,
  data: TopicsRecordedData,
): TopicModelState {
  // The seed is content-gated rather than time-ordered: a project's boot
  // seed can only ever be minted before that project clusters anything, so
  // "the model already has topics" means the seed is already superseded.
  if (data.source === "seed" && Object.keys(state.topics).length > 0) {
    return state;
  }

  const firstSeenAt = withFirstSeenAt(state.firstSeenAt, data);
  if (data.occurredAt < state.watermark) return { ...state, firstSeenAt };

  const topics = { ...state.topics };
  for (const topic of data.topics) {
    const existing = topics[topic.id];
    if (existing !== undefined && existing.asOf > data.occurredAt) continue;
    const { firstRecordedAt: _firstRecordedAt, ...content } = topic;
    topics[topic.id] = { ...content, asOf: data.occurredAt };
  }

  if (data.mode !== "replace") return { ...state, topics, firstSeenAt };

  const incomingIds = new Set(data.topics.map((topic) => topic.id));
  for (const [id, topic] of Object.entries(topics)) {
    // A topic this replace never mentioned survives only if something newer
    // than the replace wrote it.
    if (!incomingIds.has(id) && topic.asOf < data.occurredAt) {
      delete topics[id];
    }
  }
  return { watermark: data.occurredAt, topics, firstSeenAt };
}

export interface ProjectedTopic extends TopicContent {
  readonly firstRecordedAt: number;
}

export interface TopicModelView {
  readonly topics: readonly ProjectedTopic[];
}

export function deriveTopicModelView(state: TopicModelState): TopicModelView {
  const topics = Object.values(state.topics).map(
    (topic): ProjectedTopic => ({
      ...topic,
      // The fallback only covers a state decoded from a row written before
      // `firstSeenAt` existed; every write of a topic also stamps it.
      firstRecordedAt: state.firstSeenAt[topic.id] ?? topic.asOf,
    }),
  );
  // Sorted by id: insertion order is a function of delivery order, which is
  // exactly the non-determinism this fold keeps out of what a reader sees.
  topics.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { topics };
}
