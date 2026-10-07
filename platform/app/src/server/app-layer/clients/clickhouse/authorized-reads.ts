/**
 * ADR-144 block C: the store client applies the proof.
 *
 * A trace repository never names a tenant. It asks this client for a reader
 * bound to a sealed ADR-166 `Authorization` proof and writes the statement
 * with a `{{tenantScope:<TimeColumn>}}` marker where the tenant predicate
 * goes. The reader expands every marker into the fence the proof allows -
 * the own project outright, each shared project inside its grant's window -
 * and refuses a statement that carries no marker, names the tenant column
 * in a predicate of its own, or binds a parameter in the reserved prefix.
 *
 * The fence is the same expression at every marker, so a subquery and its
 * outer statement cannot disagree on who is in scope. Its size does not
 * depend on how many projects the proof names: the shared windows are bound
 * as parallel array parameters, so an aggregate over 2,000 members sends the
 * same statement text as one over two.
 *
 * Home on `main`; ports to `packages/clickhouse-client` with PR 7536.
 */
import { createHash } from "node:crypto";
import type {
  ClickHouseClient,
  DataFormat,
  QueryParams,
  QueryResult,
} from "@clickhouse/client";
import {
  AccessNotGrantedError,
  type Authorization,
  type AuthorizationConditionType,
  type AuthorizationGrant,
  usableAuthorization,
} from "@langwatch/actor";
import type { AuthzPermission } from "@langwatch/authz";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

/**
 * What a reader may be asked for: the permission each one needs, and the
 * resource a shared grant's window must apply to for that grant to open
 * rows of it. Both read trace rows, so both take a `trace` window.
 */
const READ_RESOURCES = {
  traces: { permission: "traces:view", condition: "trace" },
  analytics: { permission: "analytics:view", condition: "trace" },
} as const satisfies Record<
  string,
  { permission: AuthzPermission; condition: AuthorizationConditionType }
>;
export type ReadResource = keyof typeof READ_RESOURCES;

/**
 * The permissions a route's `.permission()` check mints a proof for: only
 * the trace read's. Every route that applies a proof is checked under
 * `traces:view`. No production read asks for `analytics` yet (analytics
 * across an aggregate's members is not delivered), so minting under
 * `analytics:view` would cost an engine pass and a shared-read lookup that
 * nothing consumes. The `analytics` resource stays so the client still
 * refuses a proof minted for traces when analytics is asked of it. Widening
 * this to every route is the foundation branch's job (PR 7536).
 */
export const PROOF_BEARING_PERMISSIONS: ReadonlySet<AuthzPermission> = new Set([
  READ_RESOURCES.traces.permission,
]);

/**
 * The time columns a marker may name. The window on a shared grant is
 * applied to this column, so it must be the table's own occurrence time:
 * `OccurredAt` on `trace_summaries`, `StartTime` on `stored_spans`,
 * `ScheduledAt` on `evaluation_runs` (each is that table's partition key in
 * migration 00002), `Timestamp` on the log tables.
 */
const TENANT_SCOPE_TIME_COLUMNS = [
  "OccurredAt",
  "StartTime",
  "ScheduledAt",
  "Timestamp",
] as const;
export type TenantScopeTimeColumn = (typeof TENANT_SCOPE_TIME_COLUMNS)[number];

/** Every parameter the fence binds starts with this; callers may not. */
const TENANT_SCOPE_PARAM_PREFIX = "tenantScope";

const MARKER = /\{\{tenantScope:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const SET_MARKER = /\{\{tenantSet\}\}/g;

/**
 * A tenant predicate written by hand. `TenantId` as a projected column or a
 * dedup tuple member is fine; `TenantId =`, `TenantId IN` and the comparison
 * forms are not, because the fence is the only predicate allowed to pick
 * tenants.
 *
 * Exported so the source-scanning gate over the converted repositories
 * (`__tests__/store-call-carries-authorization.unit.test.ts`) refuses the
 * same shapes the reader refuses at run time, and the two cannot drift.
 */
export const HAND_WRITTEN_TENANT_PREDICATE =
  /\bTenantId\s*(?:=|!=|<>|<=|>=|<|>|(?:NOT\s+)?IN\b|(?:NOT\s+)?LIKE\b)/i;

/** The marker a repository writes where its tenant predicate used to go. */
export function tenantScope(column: TenantScopeTimeColumn): string {
  return `{{tenantScope:${column}}}`;
}

/**
 * The set-only marker: every tenant the proof names, with no window. For a
 * subquery on a side table - an evaluation, an annotation, a span attribute
 * lookup - whose own timestamp is not the trace's. The window is applied
 * once, on the primary table's occurrence time, by a `tenantScope` marker
 * the statement must still carry.
 */
export function tenantSet(): string {
  return "{{tenantSet}}";
}

/**
 * A stable key for the fence a proof allows, for a cache keyed on who is in
 * scope. Two proofs that fence the same tenants under the same windows share
 * an entry; an aggregate and one of its members never do.
 *
 * The own projects stay readable, so a plain project's log line still names
 * its tenant. The shared windows are hashed, so an aggregate's key stays the
 * same length whether it reads two members or 2,000; it is a Redis key and a
 * log field, and neither should grow with the organisation.
 */
export function tenantScopeKey({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string {
  const fence = fenceFor({ authorization, reads });
  const own = [...fence.own].sort().join(",");
  if (fence.shared.length === 0) return own;
  const windows = fence.shared
    .map((window) => `${window.projectId}@${window.from}-${window.until ?? ""}`)
    .sort()
    .join("|");
  const digest = createHash("sha256").update(windows).digest("hex");
  return `${own}+${fence.shared.length}:${digest}`;
}

export type StatementScopeViolation =
  | { kind: "missing-marker" }
  | { kind: "unknown-time-column"; column: string }
  | { kind: "hand-written-tenant-predicate" }
  | { kind: "reserved-param"; param: string };

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
      return `Parameter "${violation.param}" uses the reserved "${TENANT_SCOPE_PARAM_PREFIX}" prefix.`;
  }
}

/** One shared project and the window its grant opens, as the fence binds it. */
type SharedWindow = { projectId: string; from: number; until: number | null };

type TenantFence = {
  /**
   * The own projects, read outright. Empty only on a proof narrowed to one
   * of its shared projects, where the fence is that project's window alone.
   */
  own: readonly string[];
  shared: readonly SharedWindow[];
};

/** The value an open window's `until` is bound as. */
const OPEN_UNTIL = 0;

/** A fence parameter's name, always under the reserved prefix. */
const fenceParam = (name: string) => `${TENANT_SCOPE_PARAM_PREFIX}_${name}`;

/** A fence parameter's placeholder in the statement text. */
const slot = (name: string, type: string) => `{${fenceParam(name)}:${type}}`;

/** Every tenant the fence names, own first, as the set-only marker binds it. */
function tenantsOf(fence: TenantFence): string[] {
  return [...fence.own, ...fence.shared.map((window) => window.projectId)];
}

/**
 * The fence as one bracketed expression plus the parameters it binds.
 * `column` is the table's occurrence time; the window on a shared grant is
 * applied to it. Own projects need no window.
 *
 * A plain project's proof keeps the one-clause form it always had. With
 * shared grants the expression is constant in size however many there are:
 *
 * - the outer `TenantId IN all` is ADR-144 decision 6, the set the primary
 *   key prunes on;
 * - each shared tenant's window is looked up from parallel arrays with
 *   `transform`, which builds one hash table per block for constant arrays,
 *   rather than a linear `indexOf` per row;
 * - an open window binds `until` as 0, and a closed one is clamped to at
 *   least 1 ms so a real bound can never be read as open.
 */
export function fenceExpression({
  fence,
  column,
}: {
  fence: TenantFence;
  column: TenantScopeTimeColumn;
}): { sql: string; params: Record<string, unknown> } {
  const ownClause = `TenantId IN (${slot("own", "Array(String)")})`;
  if (fence.shared.length === 0) {
    return {
      sql: `(${ownClause})`,
      params: { [fenceParam("own")]: [...fence.own] },
    };
  }

  const ids = slot("ids", "Array(String)");
  // The default is never read: `TenantId IN ids` gates every lookup.
  const edgeOf = (edge: "from" | "until") =>
    `transform(TenantId, ${ids}, ${slot(edge, "Array(Int64)")}, toInt64(0))`;
  const windowed =
    `(TenantId IN (${ids})` +
    ` AND ${column} >= fromUnixTimestamp64Milli(${edgeOf("from")})` +
    ` AND (${edgeOf("until")} = ${OPEN_UNTIL}` +
    ` OR ${column} < fromUnixTimestamp64Milli(${edgeOf("until")})))`;
  const params: Record<string, unknown> = {
    [fenceParam("all")]: tenantsOf(fence),
    [fenceParam("ids")]: fence.shared.map((window) => window.projectId),
    [fenceParam("from")]: fence.shared.map((window) => window.from),
    [fenceParam("until")]: fence.shared.map((window) =>
      window.until === null ? OPEN_UNTIL : Math.max(window.until, 1),
    ),
  };
  let picks = windowed;
  if (fence.own.length > 0) {
    params[fenceParam("own")] = [...fence.own];
    picks = `(${ownClause} OR ${windowed})`;
  }
  return {
    sql: `(TenantId IN (${slot("all", "Array(String)")}) AND ${picks})`,
    params,
  };
}

/** The set-only form: every tenant in the fence, no window. */
function setExpression(fence: TenantFence): {
  sql: string;
  params: Record<string, unknown>;
} {
  return {
    sql: `(TenantId IN (${slot("all", "Array(String)")}))`,
    params: { [fenceParam("all")]: tenantsOf(fence) },
  };
}

/**
 * The fence a proof allows for one resource. The own grant must carry the
 * resource's permission or the read is not granted at all; a shared grant
 * without it, or whose window applies to another resource (a span or log
 * window on a trace read), was minted for something else and contributes
 * nothing.
 *
 * A proof narrowed to one of its projects (ADR-144 block F) fences that
 * project alone: the own project outright, or a shared one inside its
 * grant's window. Narrowed to a shared grant that does not carry the
 * resource, it reads nothing and is refused as not granted.
 */
export function fenceFor({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): TenantFence {
  const { permission, condition } = READ_RESOURCES[reads];
  const carries = (grant: AuthorizationGrant) =>
    grant.permissions.includes(permission);
  const own = authorization.grants
    .filter((grant) => grant.kind === "own" && grant.projectId !== undefined)
    .filter(carries)
    .map((grant) => grant.projectId as string);
  if (own.length === 0) throw new AccessNotGrantedError(permission);
  const shared = authorization.grants
    .filter(
      (grant) => grant.kind === "shared" && grant.condition?.type === condition,
    )
    .filter(carries)
    .map((grant) => ({
      projectId: grant.projectId as string,
      from: grant.condition?.from ?? 0,
      until: grant.condition?.until ?? null,
    }));
  const narrowedTo = authorization.narrowedTo;
  if (narrowedTo === undefined) return { own, shared };
  const narrowed = {
    own: own.filter((projectId) => projectId === narrowedTo),
    shared: shared.filter((window) => window.projectId === narrowedTo),
  };
  if (narrowed.own.length === 0 && narrowed.shared.length === 0) {
    throw new AccessNotGrantedError(permission);
  }
  return narrowed;
}

/**
 * The own project behind a proof: the one a route minted it for, which is
 * where its Postgres rows (topic names, broadcast channels) live and whose
 * ClickHouse client every read is sent through. One own grant by
 * construction, and narrowing does not move it; a proof whose own grant
 * does not carry the resource is refused before anything reads.
 */
export function ownProjectIdOf({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string {
  const { permission } = READ_RESOURCES[reads];
  const own = authorization.grants.find(
    (grant) =>
      grant.kind === "own" &&
      grant.projectId !== undefined &&
      grant.permissions.includes(permission),
  )?.projectId;
  if (own === undefined) throw new AccessNotGrantedError(permission);
  return own;
}

/**
 * The one project a proof reads, when it reads exactly one: the project it
 * was narrowed to, or its own project when no shared grant carries the
 * resource. Undefined while the proof still spans several projects, as an
 * aggregate's list proof does. For data a proof cannot fence because it
 * lives outside ClickHouse under one project id, such as an offloaded span
 * body: a caller reads it for this project, or not at all.
 */
export function singleTenantOf({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string | undefined {
  const fence = fenceFor({ authorization, reads });
  const tenants = [
    ...fence.own,
    ...fence.shared.map((window) => window.projectId),
  ];
  return tenants.length === 1 ? tenants[0] : undefined;
}

/**
 * What a repository hands the reader: the client's own query shape, with the
 * format kept as a literal so the result set types its rows the way the
 * client's own `query` does.
 */
type ScopedQueryParams<Format extends DataFormat = "JSON"> = Omit<
  QueryParams,
  "format"
> & { format?: Format };

/**
 * The reader could not get a ClickHouse client for the project it queries
 * through, so no statement was sent. Told apart from a failed query so a
 * caller that treats an unreachable store as "nothing to show" can do so
 * without reaching for the client itself.
 */
export class ClickHouseClientUnavailableError extends Error {
  constructor({ cause }: { cause: unknown }) {
    super(
      `ClickHouse client unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "ClickHouseClientUnavailableError";
  }
}

/**
 * A reader bound to one fence. `query` expands the markers and sends the
 * statement through the own project's client; the result is the client's
 * own result set, so a repository's row mapping does not change. A client
 * that cannot be resolved surfaces as `ClickHouseClientUnavailableError`.
 */
export class TenantScopedReader {
  constructor(
    private readonly deps: {
      client: () => Promise<ClickHouseClient>;
      fence: TenantFence;
    },
  ) {}

  /** The fence this reader applies, for a caller that must log or key on it. */
  get fence(): TenantFence {
    return this.deps.fence;
  }

  async query<Format extends DataFormat = "JSON">(
    params: ScopedQueryParams<Format>,
  ): Promise<QueryResult<Format>> {
    const expanded = expandStatement({
      query: params.query,
      queryParams: params.query_params ?? {},
      fence: this.deps.fence,
    });
    const client = await this.deps.client().catch((cause: unknown) => {
      throw new ClickHouseClientUnavailableError({ cause });
    });
    return client.query({
      ...params,
      query: expanded.query,
      query_params: expanded.queryParams,
    });
  }
}

/**
 * The checks a statement and a fragment share: a caller may neither name
 * the tenant in a predicate of its own nor use the reserved parameter
 * prefix the fence writes into.
 */
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
  const bare = text.replace(MARKER, " ").replace(SET_MARKER, " ");
  if (HAND_WRITTEN_TENANT_PREDICATE.test(bare)) {
    throw new StatementScopeError({ kind: "hand-written-tenant-predicate" });
  }
}

/**
 * Expand every marker into the fence and merge its parameters. Pure, so a
 * test can assert the exact statement without a server.
 */
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
  if (expanded.windowed === 0) {
    throw new StatementScopeError({ kind: "missing-marker" });
  }
  return { query: expanded.text, queryParams: expanded.queryParams };
}

/**
 * Expand the markers of a WHERE fragment on its own.
 *
 * The bridge for a statement a legacy raw client still assembles by hand: the
 * compiled trace filter carries markers, and the one caller allowed to embed
 * it in such a statement, `app/api/traces/[[...route]]/trace-filter.ts`, has
 * to expand them into the proof's fence first. A repository reads through
 * `as()` and never needs this; a new caller is a gap in the fence, not a use.
 *
 * The fragment-level checks still apply: a hand-written tenant predicate and
 * a reserved parameter are refused. Only the whole-statement check, that a
 * windowed marker is present, is relaxed, since the statement around the
 * fragment supplies the window and names its own tenant.
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
    .replace(MARKER, (_match, column: string) => {
      if (!isTimeColumn(column)) {
        throw new StatementScopeError({ kind: "unknown-time-column", column });
      }
      windowed += 1;
      const expression = fenceExpression({ fence, column });
      merged = { ...merged, ...expression.params };
      return expression.sql;
    })
    .replace(SET_MARKER, () => {
      const expression = setExpression(fence);
      merged = { ...merged, ...expression.params };
      return expression.sql;
    });
  return { text: replaced, queryParams: merged, windowed };
}

function isTimeColumn(column: string): column is TenantScopeTimeColumn {
  return (TENANT_SCOPE_TIME_COLUMNS as readonly string[]).includes(column);
}

/**
 * The client a repository holds. `as` checks the proof - sealed, unexpired,
 * covering the resource - and returns a reader; a refusal names the reason
 * and carries no row data.
 */
export class AuthorizedClickHouse {
  constructor(
    private readonly deps: {
      resolveClient: ClickHouseClientResolver;
      now?: () => number;
    },
  ) {}

  as(
    authorization: unknown,
    { reads }: { reads: ReadResource },
  ): TenantScopedReader {
    const proof = usableAuthorization({
      authorization,
      now: this.deps.now?.() ?? Date.now(),
    });
    const fence = fenceFor({ authorization: proof, reads });
    const ownProjectId = ownProjectIdOf({ authorization: proof, reads });
    return new TenantScopedReader({
      client: () => this.deps.resolveClient(ownProjectId),
      fence,
    });
  }
}
