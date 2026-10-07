import {
  RetroactiveMutationInProgressError,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { EventLogRetention } from "@langwatch/eventing/server";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

import { EVENT_LOG_RETENTION_CLASSIFICATION } from "../../rules/event-log-retention.rules.ts";
import type { RetroactiveRetentionRepository } from "../retroactive-retention.repository.ts";

/**
 * A real twin, not a null object: mutations track in-progress rewrites and
 * refuse concurrent rewrites like the live store does.
 */
export class MemoryRetroactiveRetentionRepository implements RetroactiveRetentionRepository {
  static create(now: () => Instant = nowInstant): MemoryRetroactiveRetentionRepository {
    return new MemoryRetroactiveRetentionRepository(now);
  }

  /** Every mutation this process has been asked for, by project. */
  readonly #mutations = new Map<string, RetroactiveMutationProgress[]>();
  #nextId = 1;
  /** Eventing's own check of a category, over a store this twin does not have. */
  readonly #eventLogRetention = EventLogRetention.create({
    client: { command: async () => {} },
    classification: EVENT_LOG_RETENTION_CLASSIFICATION,
  });

  private constructor(private readonly now: () => Instant) {}

  async triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    const categoryTables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, category]) => category === input.category)
      .map(([table]) => table);
    const eventingTables: readonly string[] = this.#eventLogRetention.tables;
    const tables = [...new Set([...categoryTables, ...eventingTables])];

    // Another category's eventing rewrite touches disjoint rows, so only this category's blocks.
    const active = (this.#mutations.get(input.projectId) ?? []).filter(
      (mutation) =>
        !mutation.isDone &&
        tables.includes(mutation.table) &&
        (!eventingTables.includes(mutation.table) || mutation.category === input.category),
    );
    if (active.length > 0) throw new RetroactiveMutationInProgressError(active);
    await this.#eventLogRetention.retainCategory({
      tenantId: input.projectId,
      category: input.category,
      retentionDays: input.newRetentionDays,
    });

    const started = this.#mutations.get(input.projectId) ?? [];
    started.push(
      ...tables.map((table) => ({
        mutationId: `mutation_${this.#nextId++}`,
        table,
        isDone: false,
        partsToDo: 1,
        createTime: toDate(this.now()).toISOString().slice(0, 19),
        category: input.category,
      })),
    );
    this.#mutations.set(input.projectId, started);

    return { tables };
  }

  /** The unfinished mutations of one project, newest first. */
  async findMutationProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]> {
    return (this.#mutations.get(input.projectId) ?? [])
      .filter((mutation) => !mutation.isDone)
      .reverse();
  }

  async killMutation(input: { projectId: string; mutationId: string }): Promise<void> {
    this.#mutations.set(
      input.projectId,
      (this.#mutations.get(input.projectId) ?? []).filter(
        (mutation) => mutation.mutationId !== input.mutationId,
      ),
    );
  }
}
