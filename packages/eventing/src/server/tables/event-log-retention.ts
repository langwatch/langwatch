import { ConfigurationError, ValidationError } from "../../services/errorHandling.ts";

const EVENT_LOG_TABLE = "event_log";
const MUTATION_CATEGORY_MARKER_PREFIX = "langwatch:event-log-retention-category:";
const MAX_RETENTION_DAYS = 65_535;

/** The one statement the operation runs, in the routed ClickHouse member's own vocabulary. */
export interface EventLogRetentionClient {
  command(request: {
    tenantId: string;
    table: string;
    kind: "write";
    sql: string;
    params: Record<string, unknown>;
  }): Promise<void>;
}

/**
 * Which event_log rows each retention category owns, supplied by the retention owner since
 * eventing may not import a product module. A row of a never-expiring event type, prefix or
 * aggregate class is in no category; an unlisted aggregate type is in `fallbackCategory`.
 */
export interface EventLogRetentionClassification {
  readonly categories: readonly string[];
  readonly fallbackCategory: string;
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
    const predicate = this.categoryPredicate(category);
    if (predicate === null) return;

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
   * The category a recorded rewrite of one of {@link tables} carries on its marker; null for
   * another table, an unmarked (legacy) rewrite, or a command naming more than one category.
   */
  categoryOfMutation({
    table,
    command,
  }: {
    table: string;
    command: string | null | undefined;
  }): string | null {
    if (table !== EVENT_LOG_TABLE || !command) return null;
    const marked = this.classification.categories.filter((category) =>
      command.includes(sqlString(markerOf(category))),
    );
    return marked.length === 1 ? marked[0]! : null;
  }

  /** The finite rows of `category`, or null when no aggregate type is in it. */
  private categoryPredicate(category: string): string | null {
    const finiteGuard = `NOT ${this.indefinitePredicate()}`;
    if (category === this.classification.fallbackCategory) {
      const others = this.aggregateTypesWhere(
        (candidate) => candidate !== category && candidate !== this.classification.indefiniteClass,
      );
      return others.length === 0
        ? finiteGuard
        : `${finiteGuard} AND AggregateType NOT IN (${sqlList(others)})`;
    }
    const own = this.aggregateTypesWhere((candidate) => candidate === category);
    return own.length === 0 ? null : `${finiteGuard} AND AggregateType IN (${sqlList(own)})`;
  }

  private indefinitePredicate(): string {
    const { indefiniteEventTypePrefixes, indefiniteEventTypes, indefiniteClass } =
      this.classification;
    const terms = [
      ...indefiniteEventTypePrefixes.map((prefix) => `startsWith(EventType, ${sqlString(prefix)})`),
      ...(indefiniteEventTypes.length === 0
        ? []
        : [`EventType IN (${sqlList(indefiniteEventTypes)})`]),
      ...this.aggregateTypesWhereOrNone(indefiniteClass),
    ];
    return terms.length === 0 ? "0" : `(${terms.join(" OR ")})`;
  }

  private aggregateTypesWhereOrNone(retentionClass: string): string[] {
    const types = this.aggregateTypesWhere((candidate) => candidate === retentionClass);
    return types.length === 0 ? [] : [`AggregateType IN (${sqlList(types)})`];
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
