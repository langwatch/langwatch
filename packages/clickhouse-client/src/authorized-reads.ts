/**
 * ADR-177 block C: the store client applies the proof. A repository writes a
 * `{{tenantScope:<TimeColumn>}}` marker where its tenant predicate went; the reader expands it
 * into the proof's fence (own projects outright, shared ones inside their grant's window).
 */
import { createHash } from "node:crypto";

import {
  AccessNotGrantedError,
  type Authorization,
  type AuthorizationConditionType,
  type AuthorizationGrant,
  usableAuthorization,
  type AuthzPermission,
} from "@langwatch/authorization";
import {
  TENANT_SCOPE_TIME_COLUMNS,
  type TenantScopeTimeColumn,
} from "@langwatch/clickhouse-markers";
import { nowInstant } from "@langwatch/time";

import type { ClickHouseQueryClient } from "./client.ts";

/** Resolves the routed client a project's reads are sent through. */
export type ClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseQueryClient>;

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
 * The permissions a route mints a proof for: only `traces:view`. No production read asks for
 * `analytics` yet, so minting under it would cost an engine pass nothing consumes; a
 * traces-minted proof asked for analytics reads its own project alone.
 */
export const PROOF_BEARING_PERMISSIONS: ReadonlySet<AuthzPermission> = new Set([
  READ_RESOURCES.traces.permission,
]);

/** Every parameter the fence binds starts with this; callers may not. */
const TENANT_SCOPE_PARAM_PREFIX = "tenantScope";

const MARKER = /\{\{tenantScope:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const SET_MARKER = /\{\{tenantSet\}\}/g;

/**
 * A tenant predicate written by hand (`TenantId =`, `IN`, comparisons); a projection or dedup
 * tuple member is fine. Exported so the source scan over the converted repositories refuses
 * the same shapes the reader refuses at run time.
 */
export const HAND_WRITTEN_TENANT_PREDICATE =
  /\bTenantId\s*(?:=|!=|<>|<=|>=|<|>|(?:NOT\s+)?IN\b|(?:NOT\s+)?LIKE\b)/i;

/**
 * A stable cache key for who a proof fences, under which windows. Own projects stay readable;
 * shared windows are hashed so the key does not grow with the organisation.
 */
export function tenantScopeKey({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string {
  const fence = fenceFor({ authorization, reads });
  const own = fence.own.toSorted().join(",");
  if (fence.shared.length === 0) return own;
  const windows = fence.shared
    .map((window) => `${window.projectId}@${window.from}-${window.until ?? ""}`)
    .toSorted()
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
 * The fence as one bracketed expression plus its parameters, constant in size however many
 * shared grants: outer `TenantId IN all` prunes (ADR-177 decision 6), each window is looked up
 * from parallel arrays with `transform`, an open `until` binds as 0 and a closed one as >= 1.
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
 * The fence a proof allows for one resource. The own grant must carry the resource's permission
 * or nothing is granted; a shared grant without it, or windowed for another resource, adds
 * nothing. A narrowed proof (ADR-177 block F) fences its one project alone.
 */
export function fenceFor({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): TenantFence {
  const { permission, condition } = READ_RESOURCES[reads];
  const carries = (grant: AuthorizationGrant) => grant.permissions.includes(permission);
  const own = authorization.grants
    .filter((grant) => grant.kind === "own" && grant.projectId !== undefined)
    .filter(carries)
    .map((grant) => grant.projectId as string);
  if (own.length === 0) throw new AccessNotGrantedError(permission);
  const shared = authorization.grants
    .filter((grant) => grant.kind === "shared" && grant.condition?.type === condition)
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
 * The own project behind a proof: the one a route minted it for, whose client every read is
 * resolved through. Narrowing does not move it; an own grant without the resource is refused.
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
 * The one project a proof reads, when it reads exactly one; undefined while it spans several.
 * For data outside ClickHouse under one project id (an offloaded span body): read it for this
 * project, or not at all.
 */
export function singleTenantOf({
  authorization,
  reads,
}: {
  authorization: Authorization;
  reads: ReadResource;
}): string | undefined {
  const fence = fenceFor({ authorization, reads });
  const tenants = [...fence.own, ...fence.shared.map((window) => window.projectId)];
  return tenants.length === 1 ? tenants[0] : undefined;
}

/** What a repository hands the reader: main's statement shape, rows always as JSONEachRow. */
type ScopedQueryParams = {
  query: string;
  query_params?: Record<string, unknown>;
  format?: "JSONEachRow";
  clickhouse_settings?: Record<string, string | number>;
};

/**
 * The reader could not resolve a client, so nothing was sent. Told apart from a failed query
 * so a caller can treat an unreachable store as "nothing to show".
 */
export class TenantReaderClientUnavailableError extends Error {
  constructor({ cause }: { cause: unknown }) {
    super(
      `ClickHouse client unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "TenantReaderClientUnavailableError";
  }
}

/**
 * A reader bound to one fence: `query` expands the markers and sends the statement through the
 * routed client, declaring the fence's tenants as its tenant set (`tenantIds`).
 */
export class TenantScopedReader {
  constructor(
    private readonly deps: {
      client: () => Promise<ClickHouseQueryClient>;
      fence: TenantFence;
      tenantId: string;
    },
  ) {}

  /** The fence this reader applies, for a caller that must log or key on it. */
  get fence(): TenantFence {
    return this.deps.fence;
  }

  async query<Row = unknown>(params: ScopedQueryParams): Promise<{ json(): Promise<Row[]> }> {
    const expanded = expandStatement({
      query: params.query,
      queryParams: params.query_params ?? {},
      fence: this.deps.fence,
    });
    const client = await this.deps.client().catch((cause: unknown) => {
      throw new TenantReaderClientUnavailableError({ cause });
    });
    const result = await client.query<Row>({
      tenantId: this.deps.tenantId,
      tenantIds: tenantsOf(this.deps.fence),
      sql: expanded.query,
      params: expanded.queryParams,
      ...(params.clickhouse_settings ? { settings: params.clickhouse_settings } : {}),
    });
    return { json: async () => result.rows };
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
 * Expand a WHERE fragment's markers on its own, for the one legacy statement that embeds the
 * compiled trace filter; a repository reads through `as()` instead. The tenant-predicate and
 * reserved-prefix checks still apply; only the windowed-marker check is left to the caller.
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

  as(authorization: unknown, { reads }: { reads: ReadResource }): TenantScopedReader {
    const proof = usableAuthorization({
      authorization,
      now: this.deps.now?.() ?? nowInstant().epochMilliseconds,
    });
    const fence = fenceFor({ authorization: proof, reads });
    const ownProjectId = ownProjectIdOf({ authorization: proof, reads });
    // The request's tenant must sit in its declared set: own first, else the narrowed member.
    const [tenantId = ownProjectId] = tenantsOf(fence);
    return new TenantScopedReader({
      client: () => this.deps.resolveClient(ownProjectId),
      fence,
      tenantId,
    });
  }
}
