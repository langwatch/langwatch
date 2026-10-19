import { ConfigurationError, ValidationError } from "../../services/errorHandling.ts";
import { EVENT_TABLES } from "./event-table-declarations.ts";

const EVENT_LOG_TABLE = EVENT_TABLES[0].table;
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
    SKIP_TENANT_CHECK?: true;
  }): Promise<void>;
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
  readonly tables: readonly string[] = [EVENT_LOG_TABLE];

  private constructor(
    private readonly client: EventLogRetentionClient,
    private readonly classification: EventLogRetentionClassification,
  ) {}

  /** Rewrites the retention of the tenant's rows in `category`; an empty category runs nothing. */
  async retainCategory({
    tenantId,
    category,
    retentionDays,
  }: {
    tenantId: string;
    category: string;
    retentionDays: number;
  }): Promise<void> {
    if (!this.classification.categories.includes(category)) {
      throw new ConfigurationError(
        "EventLogRetention",
        `"${category}" is not a retention category this classification names.`,
        { category },
      );
    }
    if (
      !Number.isInteger(retentionDays) ||
      retentionDays < 0 ||
      retentionDays > MAX_RETENTION_DAYS
    ) {
      throw new ValidationError({
        reason: `Retention must be a whole number of days from 0 to ${MAX_RETENTION_DAYS}`,
        field: "retentionDays",
        value: retentionDays,
      });
    }
    const own = this.aggregateTypesWhere((candidate) => candidate === category);
    if (own.length === 0) return;
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
    if (table !== EVENT_LOG_TABLE || !command) return null;
    const classes = [...this.classification.categories, this.classification.indefiniteClass];
    const marked = classes.filter((category) => command.includes(sqlString(markerOf(category))));
    return marked.length === 1 ? marked[0]! : null;
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

function markerOf(category: string): string {
  return `${MUTATION_CATEGORY_MARKER_PREFIX}${category}`;
}

function sqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function sqlList(values: readonly string[]): string {
  return values.map(sqlString).join(", ");
}
