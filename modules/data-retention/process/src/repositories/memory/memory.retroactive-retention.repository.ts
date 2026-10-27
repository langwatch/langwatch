import type { IdIndexDeclaration } from "@langwatch/clickhouse-client";
import {
  RetroactiveMutationInProgressError,
  retentionCategories,
  type ResolvedRetention,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { EventLogRetention } from "@langwatch/eventing/server";
import { type Instant, nowInstant, toDate } from "@langwatch/time";

import { EVENT_LOG_RETENTION_CLASSIFICATION } from "../../rules/event-log-retention.rules.ts";
import { idIndexCategories } from "../../rules/id-index-categories.rules.ts";
import type {
  ClickHouseTarget,
  KeepForeverRewrite,
  RetroactiveRetentionRepository,
} from "../retroactive-retention.repository.ts";

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
    client: {
      command: async () => {},
      query: async ({ params }) => ({
        rows: this.idIndexTenants.has(String(params?.table)) ? [{ name: params?.table }] : [],
      }),
    },
    classification: EVENT_LOG_RETENTION_CLASSIFICATION,
  });

  /** The id indexes the process declared, as the live client holds them; tests set it. */
  idIndexDeclarations: readonly IdIndexDeclaration[] = [];

  /** Each declared id index this twin rewrites itself, with its source's category. */
  #idIndexCategories(): ReadonlyMap<string, RetentionCategory> {
    return idIndexCategories({
      declarations: this.idIndexDeclarations,
      eventLogIndex: this.#eventLogRetention.idIndexTable,
    });
  }

  /** The id indexes this twin's targets hold, with the tenants that have rows; tests set it. */
  idIndexTenants: ReadonlyMap<string, readonly string[]> = new Map();
  /** The retention each id index row was raised to, keyed `index/tenant/category`. */
  readonly idIndexRetention = new Map<string, number>();

  /** Keep-forever rewrites by target (`""` is the shared one), newest first; done at once. */
  readonly #keepForever = new Map<string, KeepForeverRewrite[]>();
  /** The private dataplanes this twin routes to; tests set them. */
  privateOrganizations: readonly string[] = [];

  private constructor(private readonly now: () => Instant) {}

  async triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    const categoryTables = Object.entries(RETENTION_TABLE_CATEGORY_MAP)
      .filter(([, category]) => category === input.category)
      .map(([table]) => table);
    const categoryIndexes = [...this.#idIndexCategories()]
      .filter(([, category]) => category === input.category)
      .map(([index]) => index);
    const eventingTables: readonly string[] = this.#eventLogRetention.tables;
    const tables = [...new Set([...categoryTables, ...categoryIndexes, ...eventingTables])];

    // Another category's eventing rewrite touches disjoint rows, so only this category's blocks.
    const active = (this.#mutations.get(input.projectId) ?? []).filter(
      (mutation) =>
        !mutation.isDone &&
        tables.includes(mutation.table) &&
        (!eventingTables.includes(mutation.table) || mutation.category === input.category),
    );
    if (active.length > 0) throw new RetroactiveMutationInProgressError(active);
    const eventingRewritten = await this.#eventLogRetention.retainCategory({
      tenantId: input.projectId,
      category: input.category,
      retentionDays: input.newRetentionDays,
    });
    const heldIndexes = [
      ...categoryIndexes.filter((index) => this.idIndexTenants.has(index)),
      ...eventingRewritten.filter((table) => table === this.#eventLogRetention.idIndexTable),
    ];
    for (const index of heldIndexes) {
      this.#raise({
        index,
        tenantId: input.projectId,
        category: input.category,
        retentionDays: input.newRetentionDays,
      });
    }

    const rewritten = [...new Set([...categoryTables, ...heldIndexes, ...eventingRewritten])];
    const started = this.#mutations.get(input.projectId) ?? [];
    started.push(
      ...rewritten.map((table) => ({
        mutationId: `mutation_${this.#nextId++}`,
        table,
        isDone: false,
        partsToDo: 1,
        createTime: toDate(this.now()).toISOString().slice(0, 19),
        category: input.category,
      })),
    );
    this.#mutations.set(input.projectId, started);

    return { tables: rewritten };
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

  keepForeverTargets(): readonly ClickHouseTarget[] {
    return [{}, ...this.privateOrganizations.map((organizationId) => ({ organizationId }))];
  }

  async findKeepForeverRewrites(input: ClickHouseTarget): Promise<KeepForeverRewrite[]> {
    return [...(this.#keepForever.get(input.organizationId ?? "") ?? [])];
  }

  async startKeepForeverRewrite(input: ClickHouseTarget): Promise<void> {
    await this.#eventLogRetention.keepIndefiniteRows(input);
    const key = input.organizationId ?? "";
    const rewrite = {
      mutationId: `mutation_${this.#nextId++}`,
      isDone: true,
      partsToDo: 0,
      latestFailReason: "",
    };
    this.#keepForever.set(key, [rewrite, ...(this.#keepForever.get(key) ?? [])]);
  }

  async findHeldIdIndexes(
    input: ClickHouseTarget & { indexes: readonly string[] },
  ): Promise<string[]> {
    return this.#governedIdIndexes(input.indexes).filter((index) => this.idIndexTenants.has(index));
  }

  async findIdIndexTenantIds(
    input: ClickHouseTarget & { indexes: readonly string[] },
  ): Promise<string[]> {
    const held = await this.findHeldIdIndexes(input);
    return [...new Set(held.flatMap((index) => this.idIndexTenants.get(index) ?? []))].toSorted(
      (left, right) => left.localeCompare(right),
    );
  }

  async raiseIdIndexRetention(
    input: ClickHouseTarget & {
      indexes: readonly string[];
      retentionByTenant: ReadonlyMap<string, ResolvedRetention>;
    },
  ): Promise<string[]> {
    const held = await this.findHeldIdIndexes(input);
    for (const index of held) {
      const categories =
        index === this.#eventLogRetention.idIndexTable
          ? retentionCategories
          : [this.#idIndexCategories().get(index)].filter((category) => category !== undefined);
      for (const [tenantId, retention] of input.retentionByTenant) {
        for (const category of categories) {
          this.#raise({ index, tenantId, category, retentionDays: retention[category] });
        }
      }
    }
    return held;
  }

  /** Raise-only, with a source's `0` (kept forever) written as the highest value. */
  #raise({
    index,
    tenantId,
    category,
    retentionDays,
  }: {
    index: string;
    tenantId: string;
    category: RetentionCategory;
    retentionDays: number;
  }): void {
    const key = `${index}/${tenantId}/${category}`;
    const days = retentionDays === 0 ? 65_535 : retentionDays;
    this.idIndexRetention.set(key, Math.max(this.idIndexRetention.get(key) ?? 0, days));
  }

  #governedIdIndexes(indexes: readonly string[]): string[] {
    return [...new Set(indexes)].filter(
      (index) =>
        index === this.#eventLogRetention.idIndexTable || this.#idIndexCategories().has(index),
    );
  }
}
