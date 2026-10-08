import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";

import { topicNameChanges } from "../../rules/trace-topic-names.rules.ts";
import {
  type TraceTopicName,
  type TraceTopicNamesFoldState,
  TraceTopicNamesReadRepository,
  type TraceTopicNamesRepository,
} from "../trace-topic-names.repository.ts";

type Row = { topic: TraceTopicName; removed: boolean; lastEventOccurredAt: number };

/** Trace's folded topic names in memory: one latest row per topic, as the replacing table reads. */
export class MemoryTraceTopicNamesRepository
  extends TraceTopicNamesReadRepository
  implements TraceTopicNamesRepository
{
  static create(): MemoryTraceTopicNamesRepository {
    return new MemoryTraceTopicNamesRepository();
  }

  private readonly rows = new Map<string, Map<string, Row>>();

  private constructor() {
    super();
  }

  async get(aggregateId: string): Promise<FoldStateRead<TraceTopicNamesFoldState>> {
    const rows = this.rows.get(aggregateId);
    if (!rows || rows.size === 0) return { kind: "empty" };
    const all = [...rows.values()];
    return {
      kind: "folded",
      state: {
        topics: all.filter((row) => !row.removed).map((row) => row.topic),
        LastEventOccurredAt: Math.max(...all.map((row) => row.lastEventOccurredAt)),
      },
    };
  }

  async store(state: TraceTopicNamesFoldState, context: ProjectionStoreContext): Promise<void> {
    const rows = this.rows.get(context.tenantId) ?? new Map<string, Row>();
    const previous = [...rows.values()].filter((row) => !row.removed).map((row) => row.topic);
    for (const { topic, removed } of topicNameChanges({ previous, next: state.topics })) {
      rows.set(topic.id, { topic, removed, lastEventOccurredAt: state.LastEventOccurredAt });
    }
    this.rows.set(context.tenantId, rows);
  }

  async findNamesByIds({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<Map<string, string>> {
    const rows = this.rows.get(projectId);
    const names = new Map<string, string>();
    for (const id of ids) {
      const row = rows?.get(id);
      if (row && !row.removed) names.set(id, row.topic.name);
    }
    return names;
  }
}
