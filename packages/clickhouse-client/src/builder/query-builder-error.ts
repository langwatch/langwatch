/**
 * Why the typed read builder refuses to build a statement (ADR-202, "The typed builder"). Shaped
 * like `StatementScopeError`: a stable code and a closed violation a test asserts on by kind.
 * @see specs/clickhouse/typed-query-builder.feature
 */

export type QueryBuilderViolation =
  | { kind: "missing-scope" }
  | { kind: "empty-tenant-set" }
  | { kind: "malformed-tenant-id"; tenantId: string }
  | { kind: "missing-reason" }
  | { kind: "all-tenants-on-reader" }
  | { kind: "windows-need-a-proof" }
  | { kind: "no-time-column"; table: string }
  | { kind: "proof-needs-tenant-id-column"; table: string; tenantColumn: string }
  | { kind: "final-without-tenant-key"; table: string }
  | { kind: "no-version-column"; table: string }
  | { kind: "repeat-outside-election"; table: string; column: string }
  | { kind: "version-outside-election"; table: string; column: string }
  | { kind: "latest-version-in-join" }
  | { kind: "foreign-column"; table: string; column: string }
  | { kind: "missing-source" }
  | { kind: "empty-select" }
  | { kind: "self-join"; table: string }
  | { kind: "union-mismatch"; expected: string; received: string }
  | { kind: "ordered-union" }
  | { kind: "nested-with" }
  | { kind: "bad-cte-name"; name: string }
  | { kind: "unknown-cte"; name: string }
  | { kind: "bad-alias"; name: string }
  | { kind: "bad-row-count"; value: number }
  | { kind: "unsupported-operand"; column: string }
  | { kind: "bad-constant"; value: number }
  | { kind: "foreign-scope" }
  | { kind: "table-outside-scope"; table: string; scope: string }
  | { kind: "unjoinable"; table: string }
  | { kind: "prewhere-in-join" }
  | { kind: "id-bound-in-join" }
  | { kind: "empty-id-list" }
  | { kind: "set-reads-a-column"; column: string }
  | { kind: "scalar-not-one-value"; selected: number }
  | { kind: "bad-union-order" }
  | { kind: "refused-setting"; setting: string }
  | { kind: "settings-in-union" }
  | { kind: "bound-rows-not-arrays"; column: string }
  | { kind: "bound-rows-uneven"; lengths: readonly number[] }
  | { kind: "no-tenant-table" }
  | { kind: "empty-array" }
  | { kind: "mixed-array"; types: readonly string[] };

/** A read the builder will not build. Named so a test can tell which refusal fired. */
export class QueryBuilderError extends Error {
  readonly code = "store_query_builder";
  constructor(public readonly violation: QueryBuilderViolation) {
    super(describe(violation));
    this.name = "QueryBuilderError";
  }
}

function describe(violation: QueryBuilderViolation): string {
  switch (violation.kind) {
    case "missing-scope":
      return "A read is built from a tenant scope; none was given.";
    case "empty-tenant-set":
      return "A tenant set names at least one tenant.";
    case "malformed-tenant-id":
      return `Tenant id "${violation.tenantId}" is empty or carries a comma, which would widen the tenant setting.`;
    case "missing-reason":
      return "An all-tenants scope states why it reads every tenant.";
    case "all-tenants-on-reader":
      return "An all-tenants read goes out on the system identity only; the reader identity refuses it.";
    case "windows-need-a-proof":
      return "Windows and braids are a proof's; a single, set or all-tenants scope has none.";
    case "no-time-column":
      return `Table "${violation.table}" declares no time column, so a shared window cannot be applied to it.`;
    case "proof-needs-tenant-id-column":
      return `Table "${violation.table}" keys tenants on "${violation.tenantColumn}"; a proof's fence binds TenantId.`;
    case "final-without-tenant-key":
      return `Table "${violation.table}" does not hold its tenant column in its sort key, so FINAL could collapse rows across tenants.`;
    case "no-version-column":
      return `Table "${violation.table}" declares no version column, so it has no latest version to elect.`;
    case "repeat-outside-election":
      return `An election over "${violation.table}" repeats only its own non-tenant columns, not "${violation.column}".`;
    case "version-outside-election":
      return `An election over "${violation.table}" takes the max of its own non-tenant column, not "${violation.column}".`;
    case "latest-version-in-join":
      return "A latest-version election is built on a single-table read.";
    case "foreign-column":
      return `Column "${violation.column}" belongs to "${violation.table}", which this read does not read.`;
    case "missing-source":
      return "A read names the table it reads.";
    case "empty-select":
      return "A read selects at least one value.";
    case "self-join":
      return `A read joins "${violation.table}" to itself; alias one side with aliasOf.`;
    case "union-mismatch":
      return `A UNION ALL arm selects ${violation.received}; the read selects ${violation.expected}.`;
    case "ordered-union":
      return "A UNION ALL arm carries no arms of its own.";
    case "nested-with":
      return "A common table expression carries no WITH or UNION ALL of its own.";
    case "bad-cte-name":
      return `"${violation.name}" is not a usable common table expression name.`;
    case "unknown-cte":
      return `"${violation.name}" is not a common table expression declared before this text, so it would read a stored table.`;
    case "bad-alias":
      return `"${violation.name}" is not a plain identifier naming a selected value.`;
    case "bad-row-count":
      return `A limit or offset is a non-negative integer, not ${violation.value}.`;
    case "unsupported-operand":
      return `"${violation.column}" cannot take a bound value in this position.`;
    case "bad-constant":
      return `A constant the grammar needs as text is finite and inside its bounds, not ${violation.value}.`;
    case "foreign-scope":
      return "A derived table was built under another scope; a read and its parts share one scope.";
    case "table-outside-scope":
      return `Table "${violation.table}" cannot be read under a ${violation.scope} scope.`;
    case "unjoinable":
      return `"${violation.table}" is neither a stored tenant table, a derived read selecting its tenant column nor a derived read of no tenant table, so it cannot be a join side.`;
    case "prewhere-in-join":
      return "PREWHERE applies to a one-table read; a join side filters in its own subquery.";
    case "id-bound-in-join":
      return "An {{idBound}} marker is written on a one-table read, a CTE or a derived table.";
    case "bad-union-order":
      return "A UNION ALL read is ordered by the keys it selects, not by an expression.";
    case "refused-setting":
      return `"${violation.setting}" cannot be set by a read: SQL_ and pinned settings are the scope's, and a value is a finite number or a plain word.`;
    case "scalar-not-one-value":
      return `A scalar subquery selects one value; this one selects ${violation.selected}.`;
    case "empty-id-list":
      return "An id-bound read names at least one id; an empty list reads nothing, so skip the read.";
    case "set-reads-a-column":
      return `A membership set is bound values or a function of them; it cannot read column "${violation.column}".`;
    case "settings-in-union":
      return "A SETTINGS clause binds one SELECT; set it on a read that selects from the union.";
    case "bound-rows-not-arrays":
      return `Bound rows zip one or more bound arrays, each under a plain name; "${violation.column}" is not one.`;
    case "bound-rows-uneven":
      return `Bound rows zip arrays of one length, not of lengths ${violation.lengths.join(", ")}.`;
    case "no-tenant-table":
      return "A read names at least one tenant table; bound rows alone carry no tenant predicate.";
    case "empty-array":
      return "An array literal holds at least one element; an empty typed array is a cast of [].";
    case "mixed-array":
      return `An array literal's elements share one type, not ${violation.types.join(", ")}.`;
  }
}
