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
  | { kind: "latest-version-in-join" }
  | { kind: "foreign-column"; table: string; column: string }
  | { kind: "missing-source" }
  | { kind: "empty-select" }
  | { kind: "self-join"; table: string }
  | { kind: "union-mismatch"; expected: string; received: string }
  | { kind: "ordered-union" }
  | { kind: "nested-with" }
  | { kind: "bad-cte-name"; name: string }
  | { kind: "bad-alias"; name: string }
  | { kind: "bad-row-count"; value: number }
  | { kind: "unsupported-operand"; column: string };

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
    case "latest-version-in-join":
      return "A latest-version election is built on a single-table read.";
    case "foreign-column":
      return `Column "${violation.column}" belongs to "${violation.table}", which this read does not read.`;
    case "missing-source":
      return "A read names the table it reads.";
    case "empty-select":
      return "A read selects at least one value.";
    case "self-join":
      return `A read joins "${violation.table}" to itself, which the builder does not alias.`;
    case "union-mismatch":
      return `A UNION ALL arm selects ${violation.received}; the read selects ${violation.expected}.`;
    case "ordered-union":
      return "A read with UNION ALL arms is neither ordered nor limited; order each arm's consumer instead.";
    case "nested-with":
      return "A common table expression or UNION ALL arm carries no WITH of its own.";
    case "bad-cte-name":
      return `"${violation.name}" is not a usable common table expression name.`;
    case "bad-alias":
      return `"${violation.name}" is not a plain identifier naming a selected value.`;
    case "bad-row-count":
      return `A limit or offset is a non-negative integer, not ${violation.value}.`;
    case "unsupported-operand":
      return `Column "${violation.column}" binds through a conversion that a set comparison cannot apply.`;
  }
}
