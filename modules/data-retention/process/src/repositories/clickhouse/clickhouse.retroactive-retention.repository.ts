import {
  type ClickHouseQueryClient,
  ID_INDEX_RETENTION_RAISE,
  idIndexRetentionDays,
  idIndexRetentionRaises,
  idIndexTenantsStatement,
} from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  fn,
  systemMutations,
  systemTables,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  RetroactiveMutationInProgressError,
  retentionCategorySchema,
  retroactiveMutationProgressSchema,
  type ResolvedRetention,
  type RetentionCategory,
  type RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { RETENTION_TABLE_CATEGORY_MAP } from "@langwatch/data-retention-contract/retention-tables";
import { EventLogRetention, RETENTION_RAISE_ONLY_ROW_FILTER } from "@langwatch/eventing/server";
import { z } from "zod";

import { EVENT_LOG_RETENTION_CLASSIFICATION } from "../../rules/event-log-retention.rules.ts";
import { idIndexCategories } from "../../rules/id-index-categories.rules.ts";
import {
  EVENTING_APPLY_TARGET,
  retroactiveApplyPlan,
  type RetroactiveApplyPlan,
} from "../../rules/retroactive-apply-targets.rules.ts";
import {
  keepForeverRewriteSchema,
  type ClickHouseTarget,
  type KeepForeverRewrite,
  type RetroactiveRetentionRepository,
} from "../retroactive-retention.repository.ts";

const mutationRowSchema = z
  .object({
    mutationId: z.string(),
    table: z.string(),
    isDone: z.number(),
    // `parts_to_do` is Int64, which ClickHouse's JSON output sends as a string.
    partsToDo: z.coerce.number(),
    createTime: z.string(),
    // Selected only so eventing's rewrite can be read back for its category
    // marker; dropped before a row leaves this repository.
    command: z.string().optional(),
  })
  .strict();

const mutationRowsSchema = z.array(mutationRowSchema);

const keepForeverRowsSchema = z.array(
  z
    .object({
      mutationId: z.string(),
      isDone: z.number(),
      partsToDo: z.number(),
      latestFailReason: z.string(),
      table: z.string(),
      command: z.string(),
    })
    .transform(({ table, command, ...row }) => ({
      table,
      command,
      rewrite: { ...row, isDone: row.isDone === 1 },
    })),
);

const tenantFilterSql = "position(command, {tenantFilterNeedle:String}) > 0";

const tableNameRowsSchema = z.array(z.object({ name: z.string() }));
const tenantRowsSchema = z.array(z.object({ TenantId: z.string() }));

// ClickHouse stores the command as `WHERE (TenantId = '..')` (25.x), so the needle omits WHERE.
function tenantFilterParams(projectId: string): { tenantFilterNeedle: string } {
  const escapedProjectId = projectId.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return { tenantFilterNeedle: `TenantId = '${escapedProjectId}'` };
}

/** System tables carry no tenant column: each read spans its server, on the system identity. */
const systemRead = ({ reason }: { reason: string }) =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason }) });

/** One project's open retention rewrites, matched by its needle in each mutation's command. */
function mutationsRead({ needle, tables }: { needle: string; tables?: readonly string[] }) {
  const query = systemRead({
    reason: "a project's retention rewrites, matched in each mutation's command",
  })
    .from(systemMutations)
    .select({
      mutationId: systemMutations.mutation_id,
      table: systemMutations.table,
      isDone: systemMutations.is_done,
      partsToDo: systemMutations.parts_to_do,
      createTime: fn.formatDateTime(systemMutations.create_time, "%Y-%m-%dT%H:%i:%S"),
      command: systemMutations.command,
    })
    .where(({ and, eq, gt, oneOf }) =>
      and(
        ...(tables === undefined ? [] : [oneOf(systemMutations.table, tables)]),
        gt(fn.position(systemMutations.command, "_retention_days"), 0),
        gt(fn.position(systemMutations.command, needle), 0),
        eq(systemMutations.is_done, 0),
      ),
    );
  return tables === undefined
    ? query.orderBy(systemMutations.create_time, "DESC").build()
    : query.build();
}

/**
 * Retention rewrites, over the process's one ClickHouse client. It routes
 * each statement to the tenant's own server, so this repository holds no
 * per-tenant client — every call below names the project it acts for.
 */
export class ClickHouseRetroactiveRetentionRepository implements RetroactiveRetentionRepository {
  static create(options: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseRetroactiveRetentionRepository {
    const eventLogRetention = EventLogRetention.create({
      client: options.clickhouse,
      classification: EVENT_LOG_RETENTION_CLASSIFICATION,
    });
    return new ClickHouseRetroactiveRetentionRepository(options.clickhouse, eventLogRetention);
  }

  private constructor(
    private readonly clickhouse: ClickHouseQueryClient,
    private readonly eventLogRetention: EventLogRetention,
  ) {}

  /**
   * Each id index this repository rewrites itself, with its source's category: the client's
   * declarations, which every installed module made at composition, read when asked.
   */
  private idIndexCategories(): ReadonlyMap<string, RetentionCategory> {
    return idIndexCategories({
      declarations: this.clickhouse.idIndexes().declarations(),
      eventLogIndex: this.eventLogRetention.idIndexTable,
    });
  }

  private isEventingTable(table: string): boolean {
    return this.eventLogRetention.tables.includes(table);
  }

  #plan(category: RetentionCategory): RetroactiveApplyPlan {
    return retroactiveApplyPlan({
      category,
      idIndexCategories: this.idIndexCategories(),
      eventingTables: this.eventLogRetention.tables,
    });
  }

  triggerUpdate(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    return this.#apply({ ...input, raiseOnly: false });
  }

  raiseRetention(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
  }): Promise<{ tables: string[] }> {
    return this.#apply({ ...input, raiseOnly: true });
  }

  async #apply(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
    raiseOnly: boolean;
  }): Promise<{ tables: string[] }> {
    const activeMutations = await this.findActiveMutations(input);
    if (activeMutations.length > 0) {
      throw new RetroactiveMutationInProgressError(activeMutations);
    }
    const plan = this.#plan(input.category);
    const rewritten: string[] = [];
    for (const target of plan.targets) {
      rewritten.push(...(await this.#rewriteTarget({ ...input, target })));
    }
    const eventingTables = rewritten.filter((table) => this.isEventingTable(table));
    const heldIndexes = rewritten.filter((table) => plan.categoryIndexes.includes(table));
    return { tables: [...new Set([...plan.mappedTables, ...heldIndexes, ...eventingTables])] };
  }

  plannedTables(input: { category: RetentionCategory }): string[] {
    return this.#plan(input.category).tables;
  }

  applyTargets(input: { category: RetentionCategory }): string[] {
    return this.#plan(input.category).targets;
  }

  rewriteTarget(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
    target: string;
  }): Promise<string[]> {
    return this.#rewriteTarget({ ...input, raiseOnly: false });
  }

  async #rewriteTarget(input: {
    projectId: string;
    category: RetentionCategory;
    newRetentionDays: number;
    target: string;
    raiseOnly: boolean;
  }): Promise<string[]> {
    if (input.target === EVENTING_APPLY_TARGET) {
      // Once for both of eventing's tables: it raises its own index where the target holds it.
      const eventLogRewrite = {
        tenantId: input.projectId,
        category: input.category,
        retentionDays: input.newRetentionDays,
      };
      return input.raiseOnly
        ? this.eventLogRetention.raiseCategory(eventLogRewrite)
        : this.eventLogRetention.retainCategory(eventLogRewrite);
    }
    if (this.#plan(input.category).categoryIndexes.includes(input.target)) {
      // A later migration creates each index, so a target without one yet skips it.
      const held = await this.findHeldTables({
        tenantId: input.projectId,
        tables: [input.target],
      });
      if (held.length === 0) return [];
      // An index row spans rows of differing retention, so a rewrite only ever raises it.
      await this.clickhouse.command({
        tenantId: input.projectId,
        table: input.target,
        kind: "write",
        sql:
          `ALTER TABLE ${input.target} ` +
          "UPDATE _retention_days = {retentionDays:UInt16} " +
          "WHERE TenantId = {tenantId:String} " +
          "AND _retention_days < {retentionDays:UInt16}",
        params: {
          tenantId: input.projectId,
          retentionDays: idIndexRetentionDays(input.newRetentionDays),
        },
      });
      return [input.target];
    }
    await this.clickhouse.command({
      tenantId: input.projectId,
      table: input.target,
      kind: "write",
      sql:
        `ALTER TABLE ${input.target} ` +
        "UPDATE _retention_days = {retentionDays:UInt16} " +
        "WHERE TenantId = {tenantId:String} " +
        (input.raiseOnly
          ? `AND ${RETENTION_RAISE_ONLY_ROW_FILTER}`
          : "AND _retention_days != {retentionDays:UInt16}"),
      params: {
        tenantId: input.projectId,
        retentionDays: input.newRetentionDays,
      },
    });
    return [input.target];
  }

  findActiveMutations(input: {
    projectId: string;
    category: RetentionCategory;
  }): Promise<RetroactiveMutationProgress[]> {
    return this.getActiveMutations({
      projectId: input.projectId,
      tables: this.#plan(input.category).tables,
      category: input.category,
    });
  }

  async findMutationProgress(input: { projectId: string }): Promise<RetroactiveMutationProgress[]> {
    // System.mutations carries no tenant column: the project is matched inside each command.
    const { rows } = await this.clickhouse.read({
      statement: mutationsRead({
        needle: tenantFilterParams(input.projectId).tenantFilterNeedle,
      }),
      table: "system.mutations",
      tenantId: input.projectId,
    });

    return this.parseRows(rows);
  }

  async killMutation(input: { projectId: string; mutationId: string }): Promise<void> {
    await this.clickhouse.command({
      tenantId: input.projectId,
      table: "system.mutations",
      kind: "write",
      sql: "KILL MUTATION WHERE mutation_id = {mutationId:String} " + `AND ${tenantFilterSql}`,
      params: {
        mutationId: input.mutationId,
        ...tenantFilterParams(input.projectId),
      },
      // KILL MUTATION reads system.mutations, which carries no tenant column: the project is
      // matched inside the recorded mutation command instead, which is what tenantFilterSql does.
      SKIP_TENANT_CHECK: true,
    });
  }

  keepForeverTargets(): readonly ClickHouseTarget[] {
    return [
      {},
      ...[...this.clickhouse.privateRoutes().keys()].map((organizationId) => ({ organizationId })),
    ];
  }

  async findKeepForeverRewrites(input: ClickHouseTarget): Promise<KeepForeverRewrite[]> {
    const statement = systemRead({
      reason: "the event log's keep-forever rewrite spans every tenant on a target",
    })
      .from(systemMutations)
      .select({
        mutationId: systemMutations.mutation_id,
        isDone: systemMutations.is_done,
        partsToDo: fn.toUInt32(systemMutations.parts_to_do),
        latestFailReason: systemMutations.latest_fail_reason,
        table: systemMutations.table,
        command: systemMutations.command,
      })
      .where(({ and, eq, gt, oneOf }) =>
        and(
          eq(systemMutations.database, fn.currentDatabase()),
          oneOf(systemMutations.table, this.eventLogRetention.tables),
          gt(fn.position(systemMutations.command, "_retention_days = 0"), 0),
        ),
      )
      .orderBy(systemMutations.create_time, "DESC")
      .build();
    const { rows } = await this.clickhouse.read({
      statement,
      table: "system.mutations",
      ...input,
    });
    return keepForeverRowsSchema
      .parse(rows)
      .filter(
        ({ table, command }) =>
          this.eventLogRetention.categoryOfMutation({ table, command }) ===
          EVENT_LOG_RETENTION_CLASSIFICATION.indefiniteClass,
      )
      .map(({ rewrite }) => keepForeverRewriteSchema.parse(rewrite));
  }

  async startKeepForeverRewrite(input: ClickHouseTarget): Promise<void> {
    await this.eventLogRetention.keepIndefiniteRows(input);
  }

  async findHeldIdIndexes(
    input: ClickHouseTarget & { indexes: readonly string[] },
  ): Promise<string[]> {
    const { indexes, ...target } = input;
    return this.findHeldTables({
      tenantId: "",
      ...target,
      tables: this.governedIdIndexes({ indexes, categories: this.idIndexCategories() }),
    });
  }

  async findIdIndexTenantIds(
    input: ClickHouseTarget & { indexes: readonly string[] },
  ): Promise<string[]> {
    const { indexes, ...target } = input;
    const tenantIds = new Set<string>();
    for (const index of this.governedIdIndexes({ indexes, categories: this.idIndexCategories() })) {
      // Raising a target's index is one pass over every tenant on it, so it lists them all.
      const { rows } = await this.clickhouse.read({
        statement: idIndexTenantsStatement({ index }),
        table: index,
        ...target,
      });
      for (const { TenantId } of tenantRowsSchema.parse(rows)) tenantIds.add(TenantId);
    }
    return [...tenantIds].toSorted((left, right) => left.localeCompare(right));
  }

  async raiseIdIndexRetention(
    input: ClickHouseTarget & {
      indexes: readonly string[];
      retentionByTenant: ReadonlyMap<string, ResolvedRetention>;
    },
  ): Promise<string[]> {
    const { indexes, retentionByTenant, ...target } = input;
    const raised: string[] = [];
    const categories = this.idIndexCategories();
    for (const index of this.governedIdIndexes({ indexes, categories })) {
      if (index === this.eventLogRetention.idIndexTable) {
        raised.push(
          ...(await this.eventLogRetention.raiseIdIndexRetention({ ...target, retentionByTenant })),
        );
        continue;
      }
      const category = categories.get(index);
      if (category === undefined) continue;
      await this.raiseCategoryIdIndex({ target, index, category, retentionByTenant });
      raised.push(index);
    }
    return raised;
  }

  /**
   * One raise over every tenant on the target, each to its own days, never lower; split only when
   * the tenant list passes the URL budget. Each raise rewrites every part of the index.
   */
  private async raiseCategoryIdIndex({
    target,
    index,
    category,
    retentionByTenant,
  }: {
    target: ClickHouseTarget;
    index: string;
    category: RetentionCategory;
    retentionByTenant: ReadonlyMap<string, ResolvedRetention>;
  }): Promise<void> {
    const daysByTenant = new Map(
      [...retentionByTenant].map(([tenantId, retention]) => [tenantId, retention[category]]),
    );
    for (const params of idIndexRetentionRaises({ daysByTenant })) {
      await this.clickhouse.command({
        tenantId: "",
        ...target,
        table: index,
        kind: "write",
        sql: `ALTER TABLE ${index} ${ID_INDEX_RETENTION_RAISE}`,
        params,
        // One raise per ClickHouse target over the tenants it names, which span organizations.
        SKIP_TENANT_CHECK: true,
      });
    }
  }

  /** The named indexes this module raises, in the order named; any other name is dropped. */
  private governedIdIndexes({
    indexes,
    categories,
  }: {
    indexes: readonly string[];
    categories: ReadonlyMap<string, RetentionCategory>;
  }): string[] {
    return [...new Set(indexes)].filter(
      (index) => index === this.eventLogRetention.idIndexTable || categories.has(index),
    );
  }

  /** The subset of `tables` the routed server holds. */
  private async findHeldTables({
    tables,
    ...route
  }: {
    tenantId: string;
    organizationId?: string;
    tables: readonly string[];
  }): Promise<string[]> {
    if (tables.length === 0) return [];
    const statement = systemRead({
      reason: "which of the named tables the routed server holds",
    })
      .from(systemTables)
      .select({ name: systemTables.name })
      .where(({ and, eq, oneOf }) =>
        and(eq(systemTables.database, fn.currentDatabase()), oneOf(systemTables.name, tables)),
      )
      .build();
    const { rows } = await this.clickhouse.read({ statement, table: "system.tables", ...route });
    const held = new Set(tableNameRowsSchema.parse(rows).map(({ name }) => name));
    return tables.filter((table) => held.has(table));
  }

  private async getActiveMutations(input: {
    projectId: string;
    tables: string[];
    category: RetentionCategory;
  }): Promise<RetroactiveMutationProgress[]> {
    // System.mutations carries no tenant column: the project is matched inside each command.
    const { rows } = await this.clickhouse.read({
      statement: mutationsRead({
        needle: tenantFilterParams(input.projectId).tenantFilterNeedle,
        tables: input.tables,
      }),
      table: "system.mutations",
      tenantId: input.projectId,
    });

    return this.parseRows(rows, {
      // Another category's event-log rewrite touches disjoint rows; an
      // unmarked legacy rewrite reads as the table's flat category.
      keepEventLogRow: (category) => category === null || category === input.category,
    });
  }

  private parseRows(
    rows: unknown,
    options?: { keepEventLogRow: (category: RetentionCategory | null) => boolean },
  ): RetroactiveMutationProgress[] {
    return mutationRowsSchema
      .parse(rows)
      .map(({ command, ...row }) => {
        const category = this.categoryForRow(row.table, command);
        return { row, category };
      })
      .filter(
        ({ row, category }) =>
          !this.isEventingTable(row.table) || !options || options.keepEventLogRow(category),
      )
      .map(({ row, category }) =>
        retroactiveMutationProgressSchema.parse({
          ...row,
          isDone: row.isDone === 1,
          category,
        }),
      );
  }

  /** An eventing rewrite's category is its marker's; an unmarked one falls back to the table's. */
  private categoryForRow(table: string, command: string | undefined): RetentionCategory | null {
    const marked = this.eventLogRetention.categoryOfMutation({ table, command });
    const category = retentionCategorySchema.safeParse(marked);
    return category.success ? category.data : this.categoryForTable(table);
  }

  private categoryForTable(table: string): RetentionCategory | null {
    return (
      Object.entries(RETENTION_TABLE_CATEGORY_MAP).find(([name]) => name === table)?.[1] ??
      this.idIndexCategories().get(table) ??
      null
    );
  }
}
