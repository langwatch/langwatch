/**
 * Why a reader refuses a statement before sending it: a missing or unknown `{{tenantScope}}` or
 * `{{idBound}}` marker, a hand-written tenant predicate, a reserved parameter name, a braid
 * condition the statement would not apply, or a statement over its byte budget.
 */

/** Every parameter the fence binds starts with this; callers may not. */
export const TENANT_SCOPE_PARAM_PREFIX = "tenantScope";

/** Every parameter an `{{idBound}}` marker binds starts with this; callers may not. */
export const ID_BOUND_PARAM_PREFIX = "idBound";

export type StatementScopeViolation =
  | { kind: "missing-marker" }
  | { kind: "unknown-time-column"; column: string }
  | { kind: "hand-written-tenant-predicate" }
  | { kind: "reserved-param"; param: string }
  | { kind: "unknown-id-index"; table: string }
  | { kind: "id-index-key-mismatch"; table: string; columns: string }
  | { kind: "missing-id-param"; param: string }
  | { kind: "mixed-id-bounds" }
  | { kind: "unexpanded-id-bound" }
  | { kind: "missing-condition-marker" }
  | { kind: "plain-marker-under-braids" }
  | { kind: "loose-latest-version-marker" }
  | { kind: "unsupported-condition-version"; version: number }
  | { kind: "uncompiled-braid-condition" }
  | { kind: "over-budget"; bytes: number; budget: number };

/** A statement the reader will not send. Named so a test can tell which
 *  refusal fired without reading prose. */
export class StatementScopeError extends Error {
  readonly code = "store_statement_scope";
  constructor(public readonly violation: StatementScopeViolation) {
    super(describe(violation));
    this.name = "StatementScopeError";
  }
}

function describe(violation: StatementScopeViolation): string {
  switch (violation.kind) {
    case "missing-marker":
      return "Statement carries no {{tenantScope:<TimeColumn>}} marker, so the window on a shared grant would never be applied. A {{tenantSet}} marker alone is not enough.";
    case "unknown-time-column":
      return `Marker names "${violation.column}", which is not a time column the window can be applied to.`;
    case "hand-written-tenant-predicate":
      return "Statement names TenantId in a predicate of its own. The fence is the only predicate allowed to pick tenants.";
    case "reserved-param":
      return `Parameter "${violation.param}" uses a reserved prefix ("${TENANT_SCOPE_PARAM_PREFIX}" or "${ID_BOUND_PARAM_PREFIX}").`;
    case "unknown-id-index":
      return `An {{idBound}} marker names "${violation.table}", which declares no id index.`;
    case "id-index-key-mismatch":
      return `An {{idBound}} marker names key "${violation.columns}" of "${violation.table}", which is not its id index's key.`;
    case "missing-id-param":
      return `An {{idBound}} marker names parameter "${violation.param}", which is not bound to a String or an Array(String).`;
    case "mixed-id-bounds":
      return "Statement carries {{idBound}} markers for different ids; one statement is bounded by one id lookup.";
    case "unexpanded-id-bound":
      return "Statement still carries an {{idBound}} marker; only a read through the client's query expands one.";
    case "missing-condition-marker":
      return "The proof carries braids, whose conditions only a {{tenantScopeWithConditions:<TimeColumn>}} marker on the outer select applies; this statement carries none.";
    case "plain-marker-under-braids":
      return "The proof carries braids, so a {{tenantScope}} or {{tenantSet}} marker would read owner rows with no condition. Write {{tenantScopeWithConditions:<TimeColumn>}}, and {{tenantScopeForLatestVersion:<TimeColumn>}} in a latest-version election.";
    case "loose-latest-version-marker":
      return "A {{tenantScopeForLatestVersion:<TimeColumn>}} marker sits outside a latest-version election on stored_spans, or its election is not in the WHERE a windowed marker fences.";
    case "unsupported-condition-version":
      return `A braid's condition was compiled by compiler version ${violation.version}, which this reader cannot render.`;
    case "uncompiled-braid-condition":
      return "A braid's condition reached the fence without its compiled form. Every span braid carries one; every span is stated, never implied.";
    case "over-budget":
      return `The expanded statement is ${violation.bytes} bytes, over the ${violation.budget}-byte budget ClickHouse parses.`;
  }
}
