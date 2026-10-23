import {
  ID_INDEX_KEPT_FOREVER_DAYS,
  ID_INDEX_RETENTION_RAISE,
  idIndexRetentionDays,
  idIndexRetentionRaises,
} from "@langwatch/clickhouse-client";

import { ConfigurationError, ValidationError } from "../../services/errorHandling.ts";
import { EVENT_TABLES } from "./event-table-declarations.ts";

const EVENT_LOG_TABLE = EVENT_TABLES[0].table;
const EVENT_LOG_ID_INDEX_TABLE = EVENT_TABLES[1].table;
const MUTATION_CATEGORY_MARKER_PREFIX = "langwatch:event-log-retention-category:";
const MAX_RETENTION_DAYS = 65_535;

/** The one statement the operation runs, in the routed ClickHouse member's own vocabulary. */
export interface EventLogRetentionClient {
  command(request: {
    tenantId: string;
    organizationId?: string;
    table: string;
    kind: "write";
    sql: string;
    params?: Record<string, unknown>;
    settings?: Record<string, string | number>;
    SKIP_TENANT_CHECK?: true;
  }): Promise<void>;
  /** Asked only of `system.tables`, whether the routed server holds the id index yet. */
  query(request: {
    tenantId: string;
    organizationId?: string;
    table: string;
    kind: "read";
    sql: string;
    params?: Record<string, unknown>;
    SKIP_TENANT_CHECK?: true;
  }): Promise<{ rows: unknown[] }>;
}

/**
 * Which event_log rows each retention category owns, from the retention owner (eventing may not
 * import a product module). Only customer telemetry expires (Alex, 2026-10-09): a never-expiring
 * event type or prefix, or an aggregate type mapped to no category, is kept forever.
 */
export interface EventLogRetentionClassification {
  readonly categories: readonly string[];
  /** Each aggregate type's class: a category, or `indefiniteClass`. */
  readonly classByAggregateType: Readonly<Record<string, string>>;
  readonly indefiniteClass: string;
  readonly indefiniteEventTypePrefixes: readonly string[];
  readonly indefiniteEventTypes: readonly string[];
}

/**
 * Tenant retention over eventing's event log (Q205, 2026-10-06): the rewrite data-retention ran
 * itself, per category, with the marker that tells concurrent categories' rewrites apart.
 * Spec: packages/eventing/specs/event-table-surfaces.feature.
 */
export class EventLogRetention {
  static create(options: {
    client: EventLogRetentionClient;
    classification: EventLogRetentionClassification;
  }): EventLogRetention {
    return new EventLogRetention(options.client, options.classification);
  }

  /** The tables a rewrite here touches, so a caller lists their mutations without naming them. */
  readonly tables: readonly string[] = [EVENT_LOG_TABLE, EVENT_LOG_ID_INDEX_TABLE];
  /** The event log's id index, whose rows a rewrite only ever raises. */
  readonly idIndexTable: string = EVENT_LOG_ID_INDEX_TABLE;

  private constructor(
    private readonly client: EventLogRetentionClient,
    private readonly classification: EventLogRetentionClassification,
  ) {}

  /**
   * Rewrites the retention of the tenant's rows in `category`, and raises (never lowers) its id
   * index rows where the target holds the index; answers the tables the rewrite covers. An empty
   * category runs nothing.
   */
  async retainCategory({
    tenantId,
    category,
    retentionDays,
  }: {
    tenantId: string;
    category: string;
    retentionDays: number;
  }): Promise<string[]> {
    this.assertCategory(category);
    assertRetentionDays(retentionDays);
    const own = this.aggregateTypesWhere((candidate) => candidate === category);
    if (own.length === 0) return [EVENT_LOG_TABLE];
    const predicate = `${this.finiteEventTypeGuard()}AggregateType IN (${sqlList(own)})`;

    await this.client.command({
      tenantId,
      table: EVENT_LOG_TABLE,
      kind: "write",
      sql:
        `ALTER TABLE ${EVENT_LOG_TABLE} ` +
        "UPDATE _retention_days = {retentionDays:UInt16} " +
        "WHERE TenantId = {tenantId:String} " +
        "AND _retention_days != {retentionDays:UInt16}" +
        ` AND (${predicate})` +
        ` AND length(${sqlString(markerOf(category))}) > 0`,
      params: { tenantId, retentionDays },
    });
    if (!(await this.holdsIdIndex({ tenantId }))) return [EVENT_LOG_TABLE];

    await this.client.command({
      tenantId,
      table: EVENT_LOG_ID_INDEX_TABLE,
      kind: "write",
      sql:
        `ALTER TABLE ${EVENT_LOG_ID_INDEX_TABLE} ` +
        "UPDATE _retention_days = {retentionDays:UInt16} " +
        "WHERE TenantId = {tenantId:String} " +
        "AND _retention_days < {retentionDays:UInt16}" +
        ` AND AggregateType IN (${sqlList(own)})` +
        ` AND length(${sqlString(markerOf(category))}) > 0`,
      params: { tenantId, retentionDays: idIndexRetentionDays(retentionDays) },
    });
    return [EVENT_LOG_TABLE, EVENT_LOG_ID_INDEX_TABLE];
  }

  /**
   * Raises every id index row on one target to its tenant's retention for the row's category,
   * never lowering one, and keeps an unclassified aggregate type's rows forever. Answers the
   * tables rewritten: none when the target holds no index yet.
   */
  async raiseIdIndexRetention({
    organizationId,
    retentionByTenant,
  }: {
    organizationId?: string;
    retentionByTenant: ReadonlyMap<string, Readonly<Record<string, number>>>;
  }): Promise<string[]> {
    for (const retention of retentionByTenant.values()) {
      for (const days of Object.values(retention)) assertRetentionDays(days);
    }
    if (!(await this.holdsIdIndex({ organizationId }))) return [];

    for (const category of this.classification.categories) {
      const own = this.aggregateTypesWhere((candidate) => candidate === category);
      if (own.length === 0) continue;
      // One raise per category, so each rewrite keeps the marker that names it.
      for (const params of idIndexRetentionRaises({
        daysByTenant: categoryDays({ retentionByTenant, category }),
      })) {
        await this.client.command({
          tenantId: "",
          ...(organizationId === undefined ? {} : { organizationId }),
          table: EVENT_LOG_ID_INDEX_TABLE,
          kind: "write",
          sql:
            `ALTER TABLE ${EVENT_LOG_ID_INDEX_TABLE} ${ID_INDEX_RETENTION_RAISE}` +
            ` AND AggregateType IN (${sqlList(own)})` +
            ` AND length(${sqlString(markerOf(category))}) > 0`,
          params,
          // One raise per ClickHouse target over the tenants it names, which span organizations.
          SKIP_TENANT_CHECK: true,
        });
      }
    }
    await this.keepIndefiniteIndexRows({ organizationId });
    return [EVENT_LOG_ID_INDEX_TABLE];
  }

  /**
   * Re-stamps every never-expiring row on one ClickHouse target, every tenant at once, to 0 days;
   * `organizationId` routes to that organization's private target, none to the shared one.
   */
  async keepIndefiniteRows({ organizationId }: { organizationId?: string }): Promise<void> {
    await this.client.command({
      tenantId: "",
      ...(organizationId === undefined ? {} : { organizationId }),
      table: EVENT_LOG_TABLE,
      kind: "write",
      sql:
        `ALTER TABLE ${EVENT_LOG_TABLE} UPDATE _retention_days = 0 ` +
        `WHERE _retention_days != 0 AND ${this.indefinitePredicate()}` +
        ` AND length(${sqlString(markerOf(this.classification.indefiniteClass))}) > 0`,
      // Keeping never-expiring rows forever is one rewrite per ClickHouse target, across every
      // tenant on it.
      SKIP_TENANT_CHECK: true,
    });
    if (await this.holdsIdIndex({ organizationId })) {
      await this.keepIndefiniteIndexRows({ organizationId });
    }
  }

  /**
   * The category a recorded rewrite of one of {@link tables} carries on its marker, or the
   * indefinite class for {@link keepIndefiniteRows}; null for another table, an unmarked (legacy)
   * rewrite, or a command naming more than one class.
   */
  categoryOfMutation({
    table,
    command,
  }: {
    table: string;
    command: string | null | undefined;
  }): string | null {
    if (!this.tables.includes(table) || !command) return null;
    const classes = [...this.classification.categories, this.classification.indefiniteClass];
    const marked = classes.filter((category) => command.includes(sqlString(markerOf(category))));
    return marked.length === 1 ? marked[0]! : null;
  }

  /**
   * Raises to kept forever the index rows of every aggregate type mapped to no category, and of
   * every aggregate holding a never-expiring event type: its rows were re-stamped to 0 after the
   * view wrote their finite retention, and a TTL merge would otherwise drop the aggregate's range.
   */
  private async keepIndefiniteIndexRows({
    organizationId,
  }: {
    organizationId: string | undefined;
  }): Promise<void> {
    const finite = this.aggregateTypesWhere((candidate) =>
      this.classification.categories.includes(candidate),
    );
    const indefiniteEvents = this.indefiniteEventTypeTerms();
    const kept = [
      ...(finite.length === 0 ? ["1"] : [`AggregateType NOT IN (${sqlList(finite)})`]),
      ...(indefiniteEvents.length === 0 || finite.length === 0
        ? []
        : [
            "(TenantId, AggregateType, AggregateId) IN (" +
              `SELECT TenantId, AggregateType, AggregateId FROM ${EVENT_LOG_TABLE} ` +
              `WHERE AggregateType IN (${sqlList(finite)}) AND (${indefiniteEvents.join(" OR ")}))`,
          ]),
    ];
    await this.client.command({
      tenantId: "",
      ...(organizationId === undefined ? {} : { organizationId }),
      table: EVENT_LOG_ID_INDEX_TABLE,
      kind: "write",
      sql:
        `ALTER TABLE ${EVENT_LOG_ID_INDEX_TABLE} ` +
        `UPDATE _retention_days = ${ID_INDEX_KEPT_FOREVER_DAYS} ` +
        `WHERE _retention_days < ${ID_INDEX_KEPT_FOREVER_DAYS}` +
        ` AND (${kept.join(" OR ")})` +
        ` AND length(${sqlString(markerOf(this.classification.indefiniteClass))}) > 0`,
      // A replicated table refuses a mutation's subquery unless allowed; a raise is safe to repeat.
      settings: { allow_nondeterministic_mutations: 1 },
      // Keeping never-expiring rows forever is one rewrite per ClickHouse target, across every
      // tenant on it.
      SKIP_TENANT_CHECK: true,
    });
  }

  /** Whether the routed target holds the id index yet: a later migration creates it. */
  private async holdsIdIndex({
    tenantId = "",
    organizationId,
  }: {
    tenantId?: string;
    organizationId?: string | undefined;
  }): Promise<boolean> {
    const { rows } = await this.client.query({
      tenantId,
      ...(organizationId === undefined ? {} : { organizationId }),
      table: "system.tables",
      kind: "read",
      sql: "SELECT name FROM system.tables WHERE database = currentDatabase() AND name = {table:String}",
      params: { table: EVENT_LOG_ID_INDEX_TABLE },
      // System.tables carries no tenant column: this asks what the routed server holds.
      SKIP_TENANT_CHECK: true,
    });
    return rows.length > 0;
  }

  private assertCategory(category: string): void {
    if (!this.classification.categories.includes(category)) {
      throw new ConfigurationError(
        "EventLogRetention",
        `"${category}" is not a retention category this classification names.`,
        { category },
      );
    }
  }

  /** `NOT (<never-expiring event types>) AND `, or nothing when none is declared. */
  private finiteEventTypeGuard(): string {
    const terms = this.indefiniteEventTypeTerms();
    return terms.length === 0 ? "" : `NOT (${terms.join(" OR ")}) AND `;
  }

  /** A never-expiring event type or prefix, or an aggregate type mapped to no category. */
  private indefinitePredicate(): string {
    const finite = this.aggregateTypesWhere((candidate) =>
      this.classification.categories.includes(candidate),
    );
    const terms = [
      ...this.indefiniteEventTypeTerms(),
      ...(finite.length === 0 ? ["1"] : [`AggregateType NOT IN (${sqlList(finite)})`]),
    ];
    return `(${terms.join(" OR ")})`;
  }

  private indefiniteEventTypeTerms(): string[] {
    const { indefiniteEventTypePrefixes, indefiniteEventTypes } = this.classification;
    return [
      ...indefiniteEventTypePrefixes.map((prefix) => `startsWith(EventType, ${sqlString(prefix)})`),
      ...(indefiniteEventTypes.length === 0
        ? []
        : [`EventType IN (${sqlList(indefiniteEventTypes)})`]),
    ];
  }

  private aggregateTypesWhere(accepts: (retentionClass: string) => boolean): string[] {
    return Object.entries(this.classification.classByAggregateType)
      .filter(([, retentionClass]) => accepts(retentionClass))
      .map(([aggregateType]) => aggregateType)
      .toSorted();
  }
}

function assertRetentionDays(retentionDays: number): void {
  if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > MAX_RETENTION_DAYS) {
    throw new ValidationError({
      reason: `Retention must be a whole number of days from 0 to ${MAX_RETENTION_DAYS}`,
      field: "retentionDays",
      value: retentionDays,
    });
  }
}

/** Each tenant's source days in one category; a tenant without the category is left out. */
function categoryDays({
  retentionByTenant,
  category,
}: {
  retentionByTenant: ReadonlyMap<string, Readonly<Record<string, number>>>;
  category: string;
}): Map<string, number> {
  const days = new Map<string, number>();
  for (const [tenantId, retention] of retentionByTenant) {
    const value = retention[category];
    if (value !== undefined) days.set(tenantId, value);
  }
  return days;
}

function markerOf(category: string): string {
  return `${MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
}

function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function sqlList(values: readonly string[]): string {
  return values.map(sqlString).join(", ");
}
