/**
 * ADR-175: a repository writes `{{tenantScope:<TimeColumn>}}` where its tenant predicate went and
 * reads through a reader bound to a sealed `Authorization`, which expands every marker into the
 * proof's fence and refuses no marker, a hand-written tenant predicate or a reserved parameter.
 */
import { usableAuthorization } from "@langwatch/authorization";
import {
  fenceFor,
  fenceTenants,
  type ReadResource,
  TENANT_SCOPE_MARKER,
  TENANT_SCOPE_TIME_COLUMNS,
  TENANT_SET_MARKER,
  type TenantFence,
  type TenantScopeTimeColumn,
} from "@langwatch/authorization/tenant-fence";

import type { QueryRequest, QueryResult } from "./query.ts";

const EVERY_TENANT_SCOPE_MARKER = new RegExp(TENANT_SCOPE_MARKER.source, "g");
const EVERY_TENANT_SET_MARKER = new RegExp(TENANT_SET_MARKER.source, "g");

/** Every parameter the fence binds starts with this; callers may not. */
export const TENANT_SCOPE_PARAM_PREFIX = "tenantScope";

/** The one parameter the fence binds every tenant it names to; the tenant guard reads it. */
export const TENANT_SCOPE_SET_PARAM = `${TENANT_SCOPE_PARAM_PREFIX}_all`;

/**
 * A tenant predicate written by hand. `TenantId` projected or in a dedup tuple is fine; a
 * comparison is not, because the fence is the only predicate allowed to pick tenants.
 */
export const HAND_WRITTEN_TENANT_PREDICATE =
  /\bTenantId\s*(?:=|!=|<>|<=|>=|<|>|(?:NOT\s+)?IN\b|(?:NOT\s+)?LIKE\b)/i;

export type StatementScopeViolation =
  | { kind: "missing-marker" }
  | { kind: "unknown-time-column"; column: string }
  | { kind: "hand-written-tenant-predicate" }
  | { kind: "reserved-param"; param: string };

/**
 * A statement the reader will not send: a defect in the repository that wrote it, so a plain
 * error like the tenant guard's. Its `violation` tells a test which refusal fired.
 */
export class StatementScopeError extends Error {
  constructor(readonly violation: StatementScopeViolation) {
    super(describeStatementScopeViolation(violation));
    this.name = "StatementScopeError";
  }
}

function describeStatementScopeViolation(violation: StatementScopeViolation): string {
  switch (violation.kind) {
    case "missing-marker":
      return "Statement carries no {{tenantScope:<TimeColumn>}} marker, so the window on a shared grant would never be applied. A {{tenantSet}} marker alone is not enough.";
    case "unknown-time-column":
      return `Marker names "${violation.column}", which is not a time column the window can be applied to.`;
    case "hand-written-tenant-predicate":
      return "Statement names TenantId in a predicate of its own. The fence is the only predicate allowed to pick tenants.";
    case "reserved-param":
      return `Parameter "${violation.param}" uses the reserved "${TENANT_SCOPE_PARAM_PREFIX}" prefix.`;
  }
}

/** The value an open window's `until` is bound as. */
const OPEN_UNTIL = 0;

const fenceParam = (name: string) => `${TENANT_SCOPE_PARAM_PREFIX}_${name}`;

const slot = (name: string, type: string) => `{${fenceParam(name)}:${type}}`;

/**
 * The fence as one bracketed expression plus its parameters, constant in size however many
 * shared grants there are. The outer `TenantId IN all` is the set the key prunes on and the tenant
 * guard checks; `has` inside only narrows it. Windows come from parallel arrays via `transform`.
 */
export function fenceExpression({
  fence,
  column,
}: {
  fence: TenantFence;
  column: TenantScopeTimeColumn;
}): { sql: string; params: Record<string, unknown> } {
  const scoped = `TenantId IN (${slot("all", "Array(String)")})`;
  if (fence.shared.length === 0) {
    return { sql: `(${scoped})`, params: { [TENANT_SCOPE_SET_PARAM]: fenceTenants(fence) } };
  }

  const ids = slot("ids", "Array(String)");
  // The default is never read: `has(ids, TenantId)` gates every lookup.
  const edgeOf = (edge: "from" | "until") =>
    `transform(TenantId, ${ids}, ${slot(edge, "Array(Int64)")}, toInt64(0))`;
  const windowed =
    `(has(${ids}, TenantId)` +
    ` AND ${column} >= fromUnixTimestamp64Milli(${edgeOf("from")})` +
    ` AND (${edgeOf("until")} = ${OPEN_UNTIL}` +
    ` OR ${column} < fromUnixTimestamp64Milli(${edgeOf("until")})))`;
  const params: Record<string, unknown> = {
    [TENANT_SCOPE_SET_PARAM]: fenceTenants(fence),
    [fenceParam("ids")]: fence.shared.map((window) => window.projectId),
    [fenceParam("from")]: fence.shared.map((window) => window.from),
    // A closed window is clamped to at least 1 ms so it can never read as open.
    [fenceParam("until")]: fence.shared.map((window) =>
      window.until === null ? OPEN_UNTIL : Math.max(window.until, 1),
    ),
  };
  let picks = windowed;
  if (fence.own.length > 0) {
    params[fenceParam("own")] = [...fence.own];
    picks = `(has(${slot("own", "Array(String)")}, TenantId) OR ${windowed})`;
  }
  return { sql: `(${scoped} AND ${picks})`, params };
}

/** The set-only form: every tenant in the fence, no window. */
function setExpression(fence: TenantFence): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `(TenantId IN (${slot("all", "Array(String)")}))`,
    params: { [TENANT_SCOPE_SET_PARAM]: fenceTenants(fence) },
  };
}

/** A caller may neither name the tenant in a predicate nor use the reserved prefix. */
function refuseTenantInText({
  text,
  queryParams,
}: {
  text: string;
  queryParams: Record<string, unknown>;
}): void {
  for (const param of Object.keys(queryParams)) {
    if (param.startsWith(TENANT_SCOPE_PARAM_PREFIX)) {
      throw new StatementScopeError({ kind: "reserved-param", param });
    }
  }
  const bare = text.replace(EVERY_TENANT_SCOPE_MARKER, " ").replace(EVERY_TENANT_SET_MARKER, " ");
  if (HAND_WRITTEN_TENANT_PREDICATE.test(bare)) {
    throw new StatementScopeError({ kind: "hand-written-tenant-predicate" });
  }
}

/** Expand every marker into the fence and merge its parameters. Pure. */
export function expandStatement({
  query,
  queryParams,
  fence,
}: {
  query: string;
  queryParams: Record<string, unknown>;
  fence: TenantFence;
}): { query: string; queryParams: Record<string, unknown> } {
  refuseTenantInText({ text: query, queryParams });
  const expanded = replaceMarkers({ text: query, queryParams, fence });
  if (expanded.windowed === 0) throw new StatementScopeError({ kind: "missing-marker" });
  return { query: expanded.text, queryParams: expanded.queryParams };
}

/**
 * Expand the markers of a WHERE fragment on its own, for a statement a legacy raw read still
 * assembles by hand. The fragment checks apply; only the windowed-marker check is relaxed, since
 * the statement around the fragment supplies the window.
 */
export function expandFragment({
  fragment,
  queryParams,
  fence,
}: {
  fragment: string;
  queryParams: Record<string, unknown>;
  fence: TenantFence;
}): { sql: string; params: Record<string, unknown> } {
  refuseTenantInText({ text: fragment, queryParams });
  const expanded = replaceMarkers({ text: fragment, queryParams, fence });
  return { sql: expanded.text, params: expanded.queryParams };
}

function replaceMarkers({
  text,
  queryParams,
  fence,
}: {
  text: string;
  queryParams: Record<string, unknown>;
  fence: TenantFence;
}): { text: string; queryParams: Record<string, unknown>; windowed: number } {
  let merged: Record<string, unknown> = { ...queryParams };
  let windowed = 0;
  const replaced = text
    .replace(EVERY_TENANT_SCOPE_MARKER, (_match, column: string) => {
      if (!isTimeColumn(column)) {
        throw new StatementScopeError({ kind: "unknown-time-column", column });
      }
      windowed += 1;
      const expression = fenceExpression({ fence, column });
      merged = { ...merged, ...expression.params };
      return expression.sql;
    })
    .replace(EVERY_TENANT_SET_MARKER, () => {
      const expression = setExpression(fence);
      merged = { ...merged, ...expression.params };
      return expression.sql;
    });
  return { text: replaced, queryParams: merged, windowed };
}

function isTimeColumn(column: string): column is TenantScopeTimeColumn {
  return (TENANT_SCOPE_TIME_COLUMNS as readonly string[]).includes(column);
}

/** The one call the reader makes on the routed client. */
export interface TenantScopedStatementClient {
  query<Row>(request: QueryRequest): Promise<QueryResult<Row>>;
}

/** What a repository hands the reader: a statement and its own parameters, never a tenant. */
export type TenantScopedQuery = Omit<
  QueryRequest,
  "tenantId" | "tenantIds" | "organizationId" | "unscoped"
>;

/**
 * A reader bound to one fence. It sends the statement under the fence's tenants: the first as
 * the statement's tenant, all of them as the declared set when there are several, which the
 * router keeps inside one organisation and the tenant guard checks against the bound set.
 */
export class TenantScopedReader {
  private constructor(
    private readonly clickhouse: TenantScopedStatementClient,
    readonly fence: TenantFence,
  ) {}

  static create({
    clickhouse,
    fence,
  }: {
    clickhouse: TenantScopedStatementClient;
    fence: TenantFence;
  }): TenantScopedReader {
    return new TenantScopedReader(clickhouse, fence);
  }

  query<Row>(request: TenantScopedQuery): Promise<QueryResult<Row>> {
    const expanded = expandStatement({
      query: request.sql,
      queryParams: request.params ?? {},
      fence: this.fence,
    });
    const tenants = fenceTenants(this.fence);
    const [tenantId] = tenants;
    if (tenantId === void 0) throw new StatementScopeError({ kind: "missing-marker" });
    return this.clickhouse.query<Row>({
      ...request,
      sql: expanded.query,
      params: expanded.queryParams,
      tenantId,
      ...(tenants.length > 1 ? { tenantIds: tenants } : {}),
    });
  }
}

/**
 * The client a repository holds. `as` checks the proof (sealed, unexpired, covering the
 * resource) and returns a reader; a refusal names the reason and carries no row data.
 */
export class AuthorizedClickHouse {
  private constructor(
    private readonly clickhouse: TenantScopedStatementClient,
    private readonly now: () => number,
  ) {}

  static create({
    clickhouse,
    now = Date.now,
  }: {
    clickhouse: TenantScopedStatementClient;
    now?: () => number;
  }): AuthorizedClickHouse {
    return new AuthorizedClickHouse(clickhouse, now);
  }

  as(authorization: unknown, { reads }: { reads: ReadResource }): TenantScopedReader {
    const proof = usableAuthorization({ authorization, now: this.now() });
    return TenantScopedReader.create({
      clickhouse: this.clickhouse,
      fence: fenceFor({ authorization: proof, reads }),
    });
  }
}
