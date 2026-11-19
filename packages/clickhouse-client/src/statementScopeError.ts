/**
 * Why a reader refuses a statement before sending it: a missing or unknown `{{tenantScope}}` or
 * `{{idBound}}` marker, a hand-written tenant predicate, a reserved parameter name, a braid
 * condition the statement would not apply, or a statement over its byte or parameter budget.
 */

/** Every parameter the fence binds starts with this; callers may not. */
export const TENANT_SCOPE_PARAM_PREFIX = "tenantScope";

/** Every parameter an `{{idBound}}` marker binds starts with this; callers may not. */
export const ID_BOUND_PARAM_PREFIX = "idBound";

/** Why a tenant marker is not a top-level AND conjunct of its WHERE. */
export type LooseMarkerPlacement = "not-a-conjunct" | "outside-where" | "unreadable";

/** How a select reads rows no marker of its own fences. */
export type UnfencedReadReason =
  | "no-marker"
  | "table-join"
  | "table-function"
  | "table-in"
  | "unreadable";

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
  | { kind: "settings-under-braids" }
  | { kind: "loose-tenant-marker"; marker: string; placement: LooseMarkerPlacement }
  | { kind: "shadowing-alias"; name: string }
  | { kind: "unfenced-select"; reason: UnfencedReadReason }
  | { kind: "pinned-setting"; setting: string }
  | { kind: "unsupported-condition-version"; version: number }
  | { kind: "uncompiled-braid-condition" }
  | { kind: "over-budget"; bytes: number; budget: number }
  | { kind: "over-param-budget"; params: number; budget: number };

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
      return "A {{tenantScopeForLatestVersion:<TimeColumn>}} marker sits outside a latest-version election on stored_spans, or its election is not AND-ed into the WHERE a windowed marker fences. Join every term between that marker and the election with AND alone: no OR, no NOT, no group around the election.";
    case "settings-under-braids":
      return "The proof carries braids, so a SETTINGS clause in the statement could lift the time limit the proof's expiry sets. Pass settings through the reader's clickhouse_settings instead.";
    case "loose-tenant-marker":
      return describeLooseMarker(violation);
    case "shadowing-alias":
      return `The statement names an alias "${violation.name}", a name the fence reads; the fence would read the alias in place of the column. Name the alias something else.`;
    case "unfenced-select":
      return describeUnfencedRead(violation.reason);
    case "pinned-setting":
      return `The statement names the setting "${violation.setting}", which the reader pins on every statement.`;
    case "unsupported-condition-version":
      return `A braid's condition was compiled by compiler version ${violation.version}, which this reader cannot render.`;
    case "uncompiled-braid-condition":
      return "A braid's condition reached the fence without its compiled form. Every span braid carries one; every span is stated, never implied.";
    case "over-budget":
      return `The expanded statement is ${violation.bytes} bytes, over the ${violation.budget}-byte budget ClickHouse parses.`;
    case "over-param-budget":
      return `The expanded statement binds ${violation.params} parameters, over the ${violation.budget} ClickHouse accepts in one request.`;
  }
}

function describeUnfencedRead(reason: UnfencedReadReason): string {
  const write =
    "Write a tenant marker as a top-level AND conjunct of the WHERE of every select that reads a table.";
  switch (reason) {
    case "no-marker":
      return `A select reads a table with no tenant marker in its own WHERE; a marker in another UNION arm or subquery fences none of its rows. ${write}`;
    case "table-join":
      return `A JOIN or a comma reads a table beside the fenced one. Join a subquery whose own WHERE carries a tenant marker instead. ${write}`;
    case "table-function":
      return `A select reads a table function, which no tenant marker fences. ${write}`;
    case "table-in":
      return `An IN reads a table by name, which no tenant marker fences. Write IN (a subquery whose WHERE carries a tenant marker). ${write}`;
    case "unreadable":
      return `The fence cannot follow what the statement reads with certainty (an unbalanced bracket, a FROM it cannot place, or a character it does not know), so it refuses it. ${write}`;
  }
}

function describeLooseMarker({
  marker,
  placement,
}: {
  marker: string;
  placement: LooseMarkerPlacement;
}): string {
  const write = `Write \`WHERE ${marker} AND (<your conditions>)\`, with any OR inside a bracket of its own.`;
  switch (placement) {
    case "not-a-conjunct":
      return `${marker} is not a top-level AND conjunct of its WHERE: an OR, XOR or NOT at its level, a bracket holding an OR, or a function, comparison or CASE around it would let other tenants' rows through. ${write}`;
    case "outside-where":
      return `${marker} sits outside the WHERE of the select it fences (in a SELECT list, HAVING, ON or another clause), so it filters none of the rows read. ${write}`;
    case "unreadable":
      return `The fence cannot follow the statement around ${marker} with certainty (a marker in a comment or string literal, an unbalanced bracket, or a character it does not know), so it refuses it. ${write}`;
  }
}
