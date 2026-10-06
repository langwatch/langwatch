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
 * outer statement cannot disagree on who is in scope.
 *
 * Home on `main`; ports to `packages/clickhouse-client` with PR 7536.
 */
import type {
  ClickHouseClient,
  DataFormat,
  QueryParams,
  QueryResult,
} from "@clickhouse/client";
import {
  AccessNotGrantedError,
  type Authorization,
  type AuthorizationGrant,
  usableAuthorization,
} from "@langwatch/actor";
import type { AuthzPermission } from "@langwatch/authz";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

/** What a reader may be asked for, and the permission each one needs. */
export const READ_RESOURCES = {
  traces: "traces:view",
  analytics: "analytics:view",
} as const satisfies Record<string, AuthzPermission>;
export type ReadResource = keyof typeof READ_RESOURCES;

/**
 * The permissions a route's `.permission()` check mints a proof for. A
 * route checked under any other permission reads no proof-bearing store,
 * so minting there would cost an engine pass nothing consumes. Widening
 * this to every route is the foundation branch's job (PR 7536).
 */
export const PROOF_BEARING_PERMISSIONS: ReadonlySet<AuthzPermission> = new Set(
  Object.values(READ_RESOURCES),
);

/**
 * The time columns a marker may name. The window on a shared grant is
 * applied to this column, so it must be the table's own occurrence time:
 * `OccurredAt` on `trace_summaries`, `StartTime` on `stored_spans`,
 * `ScheduledAt` on `evaluation_runs` (each is that table's partition key in
 * migration 00002), `Timestamp` on the log tables.
 */
export const TENANT_SCOPE_TIME_COLUMNS = [
  "OccurredAt",
  "StartTime",
  "ScheduledAt",
  "Timestamp",
] as const;
export type TenantScopeTimeColumn = (typeof TENANT_SCOPE_TIME_COLUMNS)[number];

/** Every parameter the fence binds starts with this; callers may not. */
export const TENANT_SCOPE_PARAM_PREFIX = "tenantScope";

const MARKER = /\{\{tenantScope:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const SET_MARKER = /\{\{tenantSet\}\}/g;

/**
 * A tenant predicate written by hand. `TenantId` as a projected column or a
 * dedup tuple member is fine; `TenantId =`, `TenantId IN` and the comparison
 * forms are not, because the fence is the only predicate allowed to pick
 * tenants.
 */
const HAND_WRITTEN_TENANT_PREDICATE =
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
 */
export function tenantScopeKey({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string {
  const fence = fenceFor({ authorization, reads });
  return [
    ...fence.own,
    ...fence.shared.map(
      (window) => `${window.projectId}@${window.from}-${window.until ?? ""}`,
    ),
  ].join("|");
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

export type TenantFence = {
  /** The own projects, read outright. Never empty. */
  own: readonly string[];
  shared: readonly SharedWindow[];
};

/**
 * The fence as one bracketed expression plus the parameters it binds.
 * `column` is the table's occurrence time; the window on a shared grant is
 * applied to it. Own projects need no window.
 */
export function fenceExpression({
  fence,
  column,
}: {
  fence: TenantFence;
  column: TenantScopeTimeColumn;
}): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {
    [`${TENANT_SCOPE_PARAM_PREFIX}_own`]: [...fence.own],
  };
  const parts = [
    `TenantId IN ({${TENANT_SCOPE_PARAM_PREFIX}_own:Array(String)})`,
  ];
  fence.shared.forEach((window, index) => {
    const id = `${TENANT_SCOPE_PARAM_PREFIX}_s${index}`;
    params[id] = window.projectId;
    params[`${id}_from`] = window.from;
    const clauses = [
      `TenantId = {${id}:String}`,
      `${column} >= fromUnixTimestamp64Milli({${id}_from:Int64})`,
    ];
    if (window.until !== null) {
      params[`${id}_until`] = window.until;
      clauses.push(`${column} < fromUnixTimestamp64Milli({${id}_until:Int64})`);
    }
    parts.push(`(${clauses.join(" AND ")})`);
  });
  return { sql: `(${parts.join(" OR ")})`, params };
}

/** The set-only form: every tenant in the fence, no window. */
export function setExpression(fence: TenantFence): {
  sql: string;
  params: Record<string, unknown>;
} {
  const param = `${TENANT_SCOPE_PARAM_PREFIX}_all`;
  return {
    sql: `(TenantId IN ({${param}:Array(String)}))`,
    params: {
      [param]: [
        ...fence.own,
        ...fence.shared.map((window) => window.projectId),
      ],
    },
  };
}

/**
 * The fence a proof allows for one resource. The own grant must carry the
 * resource's permission or the read is not granted at all; a shared grant
 * without it was minted for something else and contributes nothing.
 */
export function fenceFor({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): TenantFence {
  const permission = READ_RESOURCES[reads];
  const carries = (grant: AuthorizationGrant) =>
    grant.permissions.includes(permission);
  const own = authorization.grants
    .filter((grant) => grant.kind === "own" && grant.projectId !== undefined)
    .filter(carries)
    .map((grant) => grant.projectId as string);
  if (own.length === 0) throw new AccessNotGrantedError(permission);
  const shared = authorization.grants
    .filter((grant) => grant.kind === "shared" && grant.condition !== undefined)
    .filter(carries)
    .map((grant) => ({
      projectId: grant.projectId as string,
      from: grant.condition?.from ?? 0,
      until: grant.condition?.until ?? null,
    }));
  return { own, shared };
}

/**
 * The own project behind a proof: the one a route minted it for, which is
 * where its Postgres rows (topic names, broadcast channels) live. One own
 * grant by construction; a proof with none is refused before anything reads.
 */
export function ownProjectIdOf({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string {
  const own = fenceFor({ authorization, reads }).own[0];
  if (own === undefined) {
    throw new Error("a proof reached a read with no own project to act for");
  }
  return own;
}

/**
 * What a repository hands the reader: the client's own query shape, with the
 * format kept as a literal so the result set types its rows the way the
 * client's own `query` does.
 */
export type ScopedQueryParams<Format extends DataFormat = "JSON"> = Omit<
  QueryParams,
  "format"
> & { format?: Format };

/**
 * A reader bound to one fence. `query` expands the markers and sends the
 * statement through the own project's client; the result is the client's
 * own result set, so a repository's row mapping does not change.
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
    const client = await this.deps.client();
    return client.query({
      ...params,
      query: expanded.query,
      query_params: expanded.queryParams,
    });
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
  for (const param of Object.keys(queryParams)) {
    if (param.startsWith(TENANT_SCOPE_PARAM_PREFIX)) {
      throw new StatementScopeError({ kind: "reserved-param", param });
    }
  }
  const bare = query.replace(MARKER, " ").replace(SET_MARKER, " ");
  if (HAND_WRITTEN_TENANT_PREDICATE.test(bare)) {
    throw new StatementScopeError({ kind: "hand-written-tenant-predicate" });
  }
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
  for (const param of Object.keys(queryParams)) {
    if (param.startsWith(TENANT_SCOPE_PARAM_PREFIX)) {
      throw new StatementScopeError({ kind: "reserved-param", param });
    }
  }
  const bare = fragment.replace(MARKER, " ").replace(SET_MARKER, " ");
  if (HAND_WRITTEN_TENANT_PREDICATE.test(bare)) {
    throw new StatementScopeError({ kind: "hand-written-tenant-predicate" });
  }
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
    const ownProjectId = fence.own[0] as string;
    return new TenantScopedReader({
      client: () => this.deps.resolveClient(ownProjectId),
      fence,
    });
  }
}
