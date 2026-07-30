import type { AggregateEvent } from "@langwatch/event-sourcing";
import { z } from "zod";
import { topicClusteringEventKeyOf } from "../aggregate";
import { type TopicsRecordedData, topicModelEntrySchema } from "../schema";

/**
 * `topicModel` — the project's topic model (`specs/topic-clustering/topics-source-of-truth.feature`):
 * topics are facts on the clustering stream, and this projection is the
 * ONLY writer of the projected model. Ids pass through unchanged so
 * ClickHouse `TopicId`/`SubTopicId` references
 * (`specs/topic-clustering/trace-assignment.feature`) stay valid.
 *
 * === Field-by-field order-invariance classification (ADR-098 decision 4) ===
 *
 * This is the one fold in the pipeline where "last-write-wins" cannot be
 * applied at the whole-row level (a `replace`-mode event wipes every topic
 * not in its own payload — a wholesale tombstone, not a per-column
 * overwrite), so the design below earns order-invariance rather than
 * assuming a single LWW stamp suffices. Three fields:
 *
 * - **`watermark`** — **monotone by rank**, `max(current, incoming)` over
 *   plain numeric time — but ONLY advanced by an accepted `replace` event,
 *   never by a `merge` event. This is what makes the wipe safe: an event
 *   older than the watermark (whether replace or merge) leaves the model's
 *   CONTENT untouched, so a stale replay can never resurrect a topic a
 *   newer replace already discarded. See "Why not plain per-topic LWW"
 *   below for why this second field is necessary at all.
 * - **`topics[id]`** — **last-write-wins per topic**, ordered on the
 *   event's own `occurredAt` as that topic's `asOf` stamp (an explicit,
 *   per-field `asOf` column in ADR-099's sense — distinct from any row-level
 *   `lastAcceptedAt`, because different topics in the SAME row are written
 *   by different events at different times). A topic is upserted only if
 *   the incoming event is not older than the topic's own `asOf`, AND the
 *   event as a whole clears the watermark gate below.
 * - **`firstSeenAt[id]`** — **commutative and associative** (a plain `min`
 *   accumulator), and deliberately NOT gated by the watermark at all — see
 *   "Why `firstSeenAt` is a separate field" below. This is the field a
 *   first implementation of this fold got wrong: folding
 *   `firstRecordedAt` as "preserve the CURRENTLY EXISTING topic's value"
 *   is arrival-order dependent even when every other field here is
 *   correct, because "currently existing" depends on which event happened
 *   to be applied first, not on the events' own timestamps. Caught by
 *   `checkOrderInvariance` in `topicModel.unit.test.ts`, not by inspection
 *   — exactly the class of defect ADR-098 exists to force out through a
 *   real property check rather than a comment.
 *
 * === Why not plain per-topic LWW (why `watermark` exists at all) ===
 *
 * A `replace` event's job is not just "add/update these topics" — it is
 * "these topics ARE the model; every OTHER topic present before this event
 * is gone." A topic this replace never mentions has no `asOf` to compare
 * against (it may be a topic the fold has never even applied yet, in a
 * reordered delivery), so a per-topic-only rule cannot decide whether to
 * drop it. Concretely: replay `[replaceAt(T3, {A,D}), replaceAt(T1, {A,B})]`
 * (T3 newer, delivered first) forward, then the same two events in the
 * REVERSE arrival order. Forward: T3 applies (model = {A,D}), then the
 * stale T1 replace must be REFUSED outright — if it were allowed to run its
 * own per-topic upsert, it would reintroduce `B` (untouched since T3, so it
 * has no `asOf` for the comparison to reject) even though the model has
 * already moved past T1. `watermark` is exactly the guard that refuses it:
 * T1 < watermark(T3) skips the CONTENT update, topic B included. Reverse
 * order: T1 applies first (watermark becomes T1, model = {A,B}), then T3
 * applies (T3 >= watermark(T1), accepted; upserts A,D and wipes B, whose
 * `asOf` — T1 — is older than T3 and who is absent from T3's payload).
 * Both orders converge on `{A: T3, D: T3}`. This exact pair is exercised as
 * `topicModel.unit.test.ts`'s "does not let a stale replace resurrect a
 * topic a newer replace already dropped" — reproduced by hand before being
 * fed to `checkOrderInvariance`, per this task's requirement that an
 * order-invariance claim be checked, not merely asserted in a comment
 * (ADR-098's own complaint about the fold this replaces the reasoning
 * style of).
 *
 * A `merge` event never advances `watermark` — it does not claim to be the
 * whole model, so it must not gate what a LATER, chronologically-earlier-
 * than-some-future-replace merge is allowed to contribute. A merge older
 * than the current watermark still leaves CONTENT untouched (a merge from
 * before the model's last wipe must not resurrect what the wipe removed),
 * via the same `occurredAt < watermark` guard, without merge ever being the
 * one to move the watermark forward.
 *
 * === Why `firstSeenAt` is a separate field ===
 *
 * `firstRecordedAt` (the value a reader sees) means "the earliest instant
 * any event ever asserted this topic existed" — a fact about the EVENT
 * STREAM, not about the model's current content. A watermark-skipped event
 * still happened and still said "topic B existed at T1"; refusing to let
 * that event touch `firstSeenAt` — the way an earlier version of this fold
 * refused to let it touch anything at all — makes the reported
 * `firstRecordedAt` depend on which order the fold happened to see two
 * events in, even though the CONTENT it reports (which topics currently
 * exist, and their current fields) is correctly order-invariant. Splitting
 * "does this event affect what the model currently contains" (watermark-
 * gated) from "does this event affect the earliest-seen bookkeeping"
 * (never gated, pure `min`) is what makes both halves independently
 * provable — see `checkOrderInvariance` in `topicModel.unit.test.ts`.
 *
 * === The one documented, deliberate exception: the seed guard ===
 *
 * `source === "seed"` folds as a no-op — touching neither content nor
 * `firstSeenAt` — once the model already has any topics, REGARDLESS of the
 * seed event's own `occurredAt` relative to whatever is already there.
 * This is intentionally NOT timestamp-ordered, and is therefore not,
 * strictly, order-invariant against an adversarial reordering where a
 * seed's `occurredAt` is later than a real clustering event's yet the seed
 * is DELIVERED after it (see `topicModel.unit.test.ts`'s "is content-gated,
 * not timestamp-ordered" test, which demonstrates the one pair of orderings
 * where this genuinely diverges). The guard is preserved from the old fold
 * deliberately rather than fixed, because it encodes a real operational
 * invariant the timestamp alone cannot express: a project's one-time boot
 * seed is minted, and can only ever be minted, before that project's
 * `topic_clustering` process is bootstrapped to run any real clustering at
 * all — the seed step specifically targets legacy projects whose topics
 * predate event-sourced ownership, and bootstrapping gates on project
 * eligibility. So "has this model already been built upon by anything" is,
 * in real operation, equivalent to "has the seed already run or been
 * superseded" — the adversarial reordering the property test exhibits
 * cannot occur outside a test written specifically to exhibit it. Matching
 * `specs/topic-clustering/topics-source-of-truth.feature`'s "A late
 * duplicate seed can never remove recorded topics".
 */

const topicContentSchema = topicModelEntrySchema
  .omit({ firstRecordedAt: true })
  .extend({
    asOf: z.number(),
  });
type TopicContent = z.infer<typeof topicContentSchema>;

export const topicModelStateSchema = z.object({
  watermark: z.number(),
  topics: z.record(z.string(), topicContentSchema),
  firstSeenAt: z.record(z.string(), z.number()),
});
export type TopicModelState = z.infer<typeof topicModelStateSchema>;

const NEGATIVE_INFINITY_WATERMARK = -Infinity;

export function initTopicModelState(): TopicModelState {
  return {
    watermark: NEGATIVE_INFINITY_WATERMARK,
    topics: {},
    firstSeenAt: {},
  };
}

/** Unconditional `min` accumulator over every event that ever mentioned a
 * topic id — see the module docblock's "Why `firstSeenAt` is a separate
 * field". Never consults `state.watermark`. */
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

export function applyTopicModelEvent(
  state: TopicModelState,
  event: AggregateEvent,
): TopicModelState {
  // Derived from `aggregate.ts`'s own event-key map, not a hand-typed
  // `"topic_clustering/topicsRecorded"` literal comparison — see
  // `runStatus.ts`/`runHistory.ts`'s identical dispatch-table pattern for
  // why (`aggregate.ts`'s `topicClusteringEventKeyOf` docblock). This fold
  // reacts to exactly one key, so a single comparison stands in for the
  // `Partial<Record<TopicClusteringEventKey, Handler>>` table its two
  // siblings use — introducing that table for one entry would be ceremony,
  // not derivation, but the KEY itself is still derived, never retyped.
  if (topicClusteringEventKeyOf(event.type) !== "topicsRecorded") return state;
  const data = event.data as TopicsRecordedData;

  // The seed guard — see the module docblock's "documented, deliberate
  // exception" section for why this is content-gated rather than time-ordered.
  if (data.source === "seed" && Object.keys(state.topics).length > 0) {
    return state;
  }

  const firstSeenAt = withFirstSeenAt(state.firstSeenAt, data);

  // Refuses CONTENT changes at or below the watermark — this is what stops
  // a stale merge OR a stale replace from reintroducing topics a newer
  // replace already wiped (see the module docblock's worked example).
  // `firstSeenAt` above is intentionally computed before this gate and
  // returned regardless of it.
  if (data.occurredAt < state.watermark) {
    return { ...state, firstSeenAt };
  }

  const topics = { ...state.topics };
  for (const topic of data.topics) {
    const existing = topics[topic.id];
    if (existing !== undefined && existing.asOf > data.occurredAt) continue;
    const { firstRecordedAt: _firstRecordedAt, ...content } = topic;
    topics[topic.id] = { ...content, asOf: data.occurredAt };
  }

  if (data.mode === "replace") {
    const incomingIds = new Set(data.topics.map((t) => t.id));
    for (const [id, topic] of Object.entries(topics)) {
      if (incomingIds.has(id)) continue;
      // A topic untouched by this replace: it survives only if it is
      // strictly newer than this replace — i.e. it was written by
      // something that happened after this replace, so this replace's wipe
      // does not apply to it.
      if (topic.asOf < data.occurredAt) delete topics[id];
    }
    return { watermark: data.occurredAt, topics, firstSeenAt };
  }

  return { ...state, topics, firstSeenAt };
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
      // `firstSeenAt` always has an entry for any topic present in
      // `topics` — every event that ever added a topic to `topics` also
      // ran it through `withFirstSeenAt` in the same apply call. The `??`
      // fallback exists only for a state decoded from a row written before
      // `firstSeenAt` existed (a shape-version boundary, not a case this
      // fold's own writes can produce).
      firstRecordedAt: state.firstSeenAt[topic.id] ?? topic.asOf,
    }),
  );
  // Sorted by id for a deterministic view: `Object.values` otherwise
  // returns insertion order, which is a function of DELIVERY order and so
  // is exactly the non-determinism this whole fold exists to keep out of
  // anything a reader can observe.
  topics.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { topics };
}
