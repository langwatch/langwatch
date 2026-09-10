import {
  RetroactiveMutationInProgressError,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import type { RetroactiveRetentionRepository } from "../retroactive-retention.repository.ts";

/**
 * The rewrite path, held in this process.
 *
 * It is a real twin, not a null object: a rewrite it is asked for shows up as
 * a mutation in progress, one that is killed stops being reported, and a
 * second rewrite over the same tables refuses exactly as the live store does.
 * Answering `[]` regardless of what was asked for is what let a project's
 * in-flight retention rewrite read as finished.
 */
export class MemoryRetroactiveRetentionRepository implements RetroactiveRetentionRepository {
  static create(now: () => Date = () => new Date()): MemoryRetroactiveRetentionRepository {
    return new MemoryRetroactiveRetentionRepository(now);
  }

  /** Every mutation this process has been asked for, by project. */
  readonly #mutations = new Map<string, RetroactiveMutationProgress[]>();
  #nextId = 1;

  private constructor(private readonly now: () => Date) {}

  async triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    const tables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, category]) => category === input.category)
      .map(([table]) => table);

    const active = (this.#mutations.get(input.projectId) ?? []).filter(
      (mutation) => !mutation.isDone && tables.includes(mutation.table),
    );
    if (active.length > 0) throw new RetroactiveMutationInProgressError(active);

    const started = this.#mutations.get(input.projectId) ?? [];
    started.push(
      ...tables.map((table) => ({
        mutationId: `mutation_${this.#nextId++}`,
        table,
        isDone: false,
        partsToDo: 1,
        createTime: this.now().toISOString().slice(0, 19),
        category: input.category,
      })),
    );
    this.#mutations.set(input.projectId, started);

    return { tables };
  }

  /** The unfinished mutations of one project, newest first. */
  async getMutationProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]> {
    return (this.#mutations.get(input.projectId) ?? [])
      .filter((mutation) => !mutation.isDone)
      .toReversed();
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
