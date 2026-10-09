import { type InsightEntry, InsightNotFoundError } from "@langwatch/insight-contract";

import type { InsightRepository } from "../insight.repository.ts";
import { InsightMemoryStore } from "./insight-memory.store.ts";

/** The memory twin of `PrismaInsightRepository`, joining the same two row sets. */
export class MemoryInsightRepository implements InsightRepository {
  private constructor(private readonly rows: InsightMemoryStore) {}

  static create({ rows }: { rows: InsightMemoryStore }): MemoryInsightRepository {
    return new MemoryInsightRepository(rows);
  }

  async findForReader({
    projectId,
    userId,
    limit,
  }: {
    projectId: string;
    userId: string;
    limit: number;
  }): Promise<InsightEntry[]> {
    const prefix = `${projectId}:`;
    return [...this.rows.insights.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => this.entry({ projectId, insightId: key.slice(prefix.length), userId }))
      .filter((entry): entry is InsightEntry => entry !== undefined)
      .toSorted((a, b) => b.filedAt - a.filedAt)
      .slice(0, limit);
  }

  async getForReader(input: {
    projectId: string;
    insightId: string;
    userId: string;
  }): Promise<InsightEntry> {
    const entry = this.entry(input);
    if (!entry) throw new InsightNotFoundError(input.insightId);
    return entry;
  }

  private entry({
    projectId,
    insightId,
    userId,
  }: {
    projectId: string;
    insightId: string;
    userId: string;
  }): InsightEntry | undefined {
    const insight = this.rows.insights.get(InsightMemoryStore.insightKey({ projectId, insightId }));
    if (!insight) return void 0;
    const reader = this.rows.readers.get(
      InsightMemoryStore.readerKey({ projectId, insightId, userId }),
    )?.state;
    return {
      id: insightId,
      ...insight.state,
      seenAt: reader?.seenAt ?? null,
      archivedAt: reader?.archivedAt ?? null,
      keptAt: reader?.keptAt ?? null,
    };
  }
}
