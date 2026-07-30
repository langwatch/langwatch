/**
 * Persisted shape of the topic model read model (Postgres `Topic` table +
 * `topicModelProjection` cursor row). Recovered from the deleted
 * event-sourcing tree: the pipeline's own `topicModel` fold now writes to
 * ClickHouse (see `event-sourcing/topic-clustering-processing`), so this
 * type describes this Postgres write-through store on its own.
 */
/**
 * One topic as carried on a `topics_recorded` event. `firstRecordedAt` is
 * optional here: seeds carry the original createdAt, clustering omits it and
 * the event's own `occurredAt` is used instead.
 */
export interface TopicModelEntry {
  id: string;
  name: string;
  parentId: string | null;
  embeddingsModel: string;
  centroid: number[];
  p95Distance: number;
  automaticallyGenerated: boolean;
  firstRecordedAt?: number;
}

/** A projected topic with its firstRecordedAt resolved (never optional). */
export interface ProjectedTopic
  extends Omit<TopicModelEntry, "firstRecordedAt"> {
  firstRecordedAt: number;
  /**
   * The `topics_recorded` event that recorded this topic — per-row
   * provenance into the event log. Null only on rows written before the
   * column existed.
   */
  recordedByEventId: string | null;
}

export interface TopicModelData {
  ProjectId: string;
  Topics: ProjectedTopic[];
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}
