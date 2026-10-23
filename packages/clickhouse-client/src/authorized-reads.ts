/**
 * ADR-177 block C: the store client applies the proof. A repository writes a
 * `{{tenantScope:<TimeColumn>}}` marker where its tenant predicate went; the reader expands it
 * into the proof's fence (own projects outright, shared ones inside their grant's window).
 */
import { createHash } from "node:crypto";

import {
  AccessNotGrantedError,
  AuthorizationExpiredError,
  type Authorization,
  type AuthorizationConditionType,
  type AuthorizationGrant,
  BRAID_CONDITION_COMPILER_VERSION,
  braidConditionDigest,
  type BraidConditionTerm,
  braidConditionTermsOf,
  type CompiledWhere,
  isSpanBraidGrant,
  type ProofBearingPermission,
  type SharedWindow,
  sharedWindowsReadBy,
  usableAuthorization,
  VERIFIED_ATTRIBUTE_PREFIX,
} from "@langwatch/authorization";
import {
  TENANT_SCOPE_BUCKET_WIDTH_MS,
  TENANT_SCOPE_TIME_COLUMNS,
  type TenantScopeTimeColumn,
} from "@langwatch/clickhouse-markers";
import { nowInstant } from "@langwatch/time";

import type { ClickHouseQueryClient } from "./client.ts";
import type { IdBoundOptions } from "./idBound.ts";
import { refuseOverBudget } from "./statementBudget.ts";
import { StatementScopeError, TENANT_SCOPE_PARAM_PREFIX } from "./statementScopeError.ts";

/** Resolves the routed client a project's reads are sent through. */
export type ClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseQueryClient>;

/**
 * What a reader may be asked for: the proof-bearing permission each needs, and the resources a
 * shared grant's window must apply to. Trace, analytics and cost reads take `trace` windows
 * (ADR-177 v4.9, v4.15); span reads also take a braid's `span` ones (ADR-185).
 */
const READ_RESOURCES = {
  traces: { permission: "traces:view", conditions: ["trace"] },
  analytics: { permission: "analytics:view", conditions: ["trace"] },
  cost: { permission: "cost:view", conditions: ["trace"] },
  spans: { permission: "traces:view", conditions: ["trace", "span"] },
} as const satisfies Record<
  string,
  { permission: ProofBearingPermission; conditions: readonly AuthorizationConditionType[] }
>;
export type ReadResource = keyof typeof READ_RESOURCES;

const MARKER = /\{\{tenantScope:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const SET_MARKER = /\{\{tenantSet\}\}/g;
const CONDITIONS_MARKER = /\{\{tenantScopeWithConditions:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/**
 * A tenant predicate written by hand (`TenantId =`, `IN`, comparisons); a projection, a dedup
 * tuple member or a join key equating two `TenantId` columns is fine. Exported so the source
 * scan over the converted repositories refuses the shapes the reader refuses at run time.
 */
export const HAND_WRITTEN_TENANT_PREDICATE =
  /\bTenantId\s*(?:=(?!\s*(?:[A-Za-z_]\w*\.)?TenantId\b)|!=|<>|<=|>=|<|>|(?:NOT\s+)?IN\b|(?:NOT\s+)?LIKE\b)/i;

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
  const windows = fence.shared.map(windowKey).toSorted().join("|");
  const digest = createHash("sha256").update(windows).digest("hex");
  const key = `${own}+${fence.shared.length}:${digest}`;
  if (fence.braids === undefined) return key;
  const clauses = fence.braids.clauses
    .map((clause) => `${clause.digest}=${clause.windows.map(windowKey).toSorted().join(",")}`)
    .toSorted()
    .join("|");
  const braids = createHash("sha256").update(clauses).digest("hex");
  return `${key}~${fence.braids.clauses.length}:${braids}`;
}

const windowKey = (window: SharedWindow): string =>
  `${window.projectId}@${window.from}-${window.until ?? ""}`;

/**
 * One bracketed clause of the conditions marker: owners and their windows under one compiled
 * predicate (none for a braid with no condition). An owner sits once per clause; a second
 * disjoint window under the same predicate goes in a clause of its own.
 */
type BraidClause = {
  compiledWhere: CompiledWhere | undefined;
  digest: string;
  windows: readonly SharedWindow[];
};

type TenantFence = {
  /**
   * The own projects, read outright. Empty only on a proof narrowed to one
   * of its shared projects, where the fence is that project's window alone.
   */
  own: readonly string[];
  /** Windows the tenant marker binds; a braid owner's spans all its braids' windows. */
  shared: readonly SharedWindow[];
  /** Set only on a span read whose proof carries braids; `reader` binds `Verified()`. */
  braids?: { reader: string; clauses: readonly BraidClause[] };
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

  const windowed = windowsOf({ column, windows: fence.shared, name: (part) => part });
  const params: Record<string, unknown> = {
    [fenceParam("all")]: tenantsOf(fence),
    ...windowed.params,
  };
  let picks = `(${windowed.sql})`;
  if (fence.own.length > 0) {
    params[fenceParam("own")] = [...fence.own];
    picks = `(${ownClause} OR ${picks})`;
  }
  return {
    sql: `(TenantId IN (${slot("all", "Array(String)")}) AND ${picks})`,
    params,
  };
}

/**
 * Windows looked up from three parallel arrays named by `name`, unbracketed so a braid clause can
 * append its predicate. The `transform` default is never read: `TenantId IN ids` gates it.
 */
function windowsOf({
  column,
  windows,
  name,
}: {
  column: TenantScopeTimeColumn;
  windows: readonly SharedWindow[];
  name: (part: "ids" | "from" | "until") => string;
}): { sql: string; params: Record<string, unknown> } {
  const ids = slot(name("ids"), "Array(String)");
  const edgeOf = (edge: "from" | "until") =>
    `transform(TenantId, ${ids}, ${slot(name(edge), "Array(Int64)")}, toInt64(0))`;
  const width = TENANT_SCOPE_BUCKET_WIDTH_MS[column];
  // A bucket starting at or after `from` lies wholly after it; one ending by `until` lies
  // wholly before it.
  const closedUntil =
    width === undefined
      ? `${column} < fromUnixTimestamp64Milli(${edgeOf("until")})`
      : `${column} <= fromUnixTimestamp64Milli(${edgeOf("until")} - ${width})`;
  return {
    sql:
      `TenantId IN (${ids})` +
      ` AND ${column} >= fromUnixTimestamp64Milli(${edgeOf("from")})` +
      ` AND (${edgeOf("until")} = ${OPEN_UNTIL}` +
      ` OR ${closedUntil})`,
    params: {
      [fenceParam(name("ids"))]: windows.map((window) => window.projectId),
      [fenceParam(name("from"))]: windows.map((window) => window.from),
      [fenceParam(name("until"))]: windows.map((window) =>
        window.until === null ? OPEN_UNTIL : Math.max(window.until, 1),
      ),
    },
  };
}

/**
 * The conditions marker (ADR-185 §3): own projects outright, OR one bracketed clause per
 * distinct predicate holding its owners' windows AND the predicate, every key and literal bound.
 * The `OR` is the fence's, beneath its exact tenant set. With no braids it is the tenant marker.
 */
export function conditionsExpression({
  fence,
  column,
}: {
  fence: TenantFence;
  column: TenantScopeTimeColumn;
}): { sql: string; params: Record<string, unknown> } {
  const { braids } = fence;
  if (braids === undefined) return fenceExpression({ fence, column });
  const params: Record<string, unknown> = { [fenceParam("all")]: tenantsOf(fence) };
  const picks: string[] = [];
  if (fence.own.length > 0) {
    params[fenceParam("own")] = [...fence.own];
    picks.push(`TenantId IN (${slot("own", "Array(String)")})`);
  }
  braids.clauses.forEach((clause, index) => {
    const name = (part: string) => `c${index}_${part}`;
    const windowed = windowsOf({ column, windows: clause.windows, name });
    Object.assign(params, windowed.params);
    if (clause.compiledWhere === undefined) {
      picks.push(`(${windowed.sql})`);
      return;
    }
    const predicate = predicateOf({
      compiledWhere: clause.compiledWhere,
      param: (part) => fenceParam(name(part)),
      readerSlot: slot("reader", "String"),
    });
    Object.assign(params, predicate.params);
    if (predicate.verifies) params[fenceParam("reader")] = braids.reader;
    picks.push(`(${windowed.sql} AND (${predicate.sql}))`);
  });
  return {
    sql: `(TenantId IN (${slot("all", "Array(String)")}) AND (${picks.join(" OR ")}))`,
    params,
  };
}

/**
 * A compiled condition rendered for a statement of a module's own, the braid preview's
 * (ADR-185 §7): the fence's conjunction, every key and literal bound under `prefix`, and
 * `Verified()` against `reader`. The prefix may not be the fence's own.
 */
export function braidConditionExpression({
  compiledWhere,
  reader,
  prefix,
}: {
  compiledWhere: CompiledWhere;
  reader: string;
  prefix: string;
}): { sql: string; params: Record<string, unknown> } {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(prefix) || prefix.startsWith(TENANT_SCOPE_PARAM_PREFIX)) {
    throw new StatementScopeError({ kind: "reserved-param", param: prefix });
  }
  const predicate = predicateOf({
    compiledWhere,
    param: (part) => `${prefix}_${part}`,
    readerSlot: `{${prefix}_reader:String}`,
  });
  const params = predicate.verifies
    ? { ...predicate.params, [`${prefix}_reader`]: reader }
    : predicate.params;
  return { sql: `(${predicate.sql})`, params };
}

/** A compiled condition as one conjunction over the span's columns, each key and value bound. */
function predicateOf({
  compiledWhere,
  param,
  readerSlot,
}: {
  compiledWhere: CompiledWhere;
  param: (part: string) => string;
  readerSlot: string;
}): { sql: string; params: Record<string, unknown>; verifies: boolean } {
  if (compiledWhere.version !== BRAID_CONDITION_COMPILER_VERSION) {
    throw new StatementScopeError({
      kind: "unsupported-condition-version",
      version: compiledWhere.version,
    });
  }
  const params: Record<string, unknown> = {};
  let verifies = false;
  const bind = (part: string, value: string): string => {
    params[param(part)] = value;
    return `{${param(part)}:String}`;
  };
  const termSql = (term: BraidConditionTerm, index: number): string => {
    switch (term.kind) {
      case "attributeEquals": {
        const map = term.on === "span" ? "SpanAttributes" : "ResourceAttributes";
        return `${map}[${bind(`${index}k`, term.key)}] = ${bind(`${index}v`, term.value)}`;
      }
      case "nameEquals":
        return `SpanName = ${bind(`${index}v`, term.value)}`;
      case "attributePresent":
        return `mapContains(SpanAttributes, ${bind(`${index}k`, term.key)})`;
      case "verified":
        verifies = true;
        return `SpanAttributes[${bind(`${index}k`, `${VERIFIED_ATTRIBUTE_PREFIX}${term.key}`)}] = ${readerSlot}`;
    }
  };
  const sql = braidConditionTermsOf(compiledWhere.tree).map(termSql).join(" AND ");
  return { sql, params, verifies };
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
  const { permission, conditions } = READ_RESOURCES[reads];
  const opens = (type: AuthorizationConditionType | undefined) =>
    (conditions as readonly AuthorizationConditionType[]).some((each) => each === type);
  const carries = (grant: AuthorizationGrant) => grant.permissions.includes(permission);
  const own = authorization.grants
    .filter((grant) => grant.kind === "own" && grant.projectId !== undefined)
    .filter(carries)
    .map((grant) => grant.projectId as string);
  if (own.length === 0) throw new AccessNotGrantedError(permission);
  const shared = (conditions as readonly AuthorizationConditionType[]).includes("trace")
    ? sharedWindowsReadBy({ authorization, permission, condition: "trace" })
    : [];
  const braided = authorization.grants
    .filter((grant) => isSpanBraidGrant(grant) && opens(grant.condition?.type))
    .filter(carries);
  const [reader = ""] = own;
  const narrowedTo = authorization.narrowedTo;
  if (narrowedTo === undefined) return withBraids({ fence: { own, shared }, braided, reader });
  const narrowed = {
    own: own.filter((projectId) => projectId === narrowedTo),
    shared: shared.filter((window) => window.projectId === narrowedTo),
  };
  if (narrowed.own.length === 0 && narrowed.shared.length === 0) {
    throw new AccessNotGrantedError(permission);
  }
  // Braids read into the own project's traces, so only narrowing to it keeps them (ADR-185 §5).
  return withBraids({ fence: narrowed, braided: narrowed.own.length > 0 ? braided : [], reader });
}

const windowOf = (grant: AuthorizationGrant): SharedWindow => ({
  projectId: grant.projectId as string,
  from: grant.condition?.from ?? 0,
  until: grant.condition?.until ?? null,
});

/**
 * Adds a span read's braids: the tenant marker binds each owner's widest window (the conditions
 * marker re-applies the exact ones), and the conditions marker groups windows by predicate. A
 * proof with no braids returns the fence unchanged, so every other read renders as before.
 */
function withBraids({
  fence,
  braided,
  reader,
}: {
  fence: TenantFence;
  braided: readonly AuthorizationGrant[];
  reader: string;
}): TenantFence {
  if (braided.length === 0) return fence;
  // A trace window read beside braids is a clause with no predicate.
  const entries = [
    ...braided.map((grant) => ({
      compiledWhere: grant.condition?.compiledWhere,
      window: windowOf(grant),
    })),
    ...fence.shared.map((window) => ({ compiledWhere: undefined, window })),
  ];
  const byPredicate = new Map<string, BraidClause>();
  for (const { compiledWhere, window } of entries) {
    const digest = compiledWhere === undefined ? "" : braidConditionDigest(compiledWhere);
    const clause = byPredicate.get(digest) ?? { compiledWhere, digest, windows: [] };
    byPredicate.set(digest, { ...clause, windows: [...clause.windows, window] });
  }
  const clauses = [...byPredicate.values()].flatMap(layeredByOwner);
  const widest = mergedByOwner(braided.map(windowOf)).map(hullOf);
  return { ...fence, shared: [...fence.shared, ...widest], braids: { reader, clauses } };
}

/** Each owner's windows, overlapping ones merged, earliest first. */
function mergedByOwner(windows: readonly SharedWindow[]): SharedWindow[][] {
  const owners = new Map<string, SharedWindow[]>();
  for (const window of windows.toSorted((left, right) => left.from - right.from)) {
    const merged = owners.get(window.projectId) ?? [];
    const last = merged.at(-1);
    if (last !== undefined && (last.until === null || window.from <= last.until)) {
      const until =
        last.until === null || window.until === null ? null : Math.max(last.until, window.until);
      merged[merged.length - 1] = { ...last, until };
    } else {
      merged.push(window);
    }
    owners.set(window.projectId, merged);
  }
  return [...owners.values()];
}

/** The one window spanning every window of one owner. */
function hullOf(windows: readonly SharedWindow[]): SharedWindow {
  const [first] = windows;
  if (first === undefined) throw new Error("an owner holds at least one window");
  const last = windows.at(-1) ?? first;
  return { projectId: first.projectId, from: first.from, until: last.until };
}

/** One clause per layer: layer n holds each owner's nth disjoint window under the predicate. */
function layeredByOwner(clause: BraidClause): BraidClause[] {
  const owners = mergedByOwner(clause.windows);
  const layers = Math.max(...owners.map((windows) => windows.length));
  return Array.from({ length: layers }, (_, layer) => ({
    ...clause,
    windows: owners.flatMap((windows) => windows[layer] ?? []),
  }));
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
  /** Set when the read must walk every partition; see the member's cold-scan warning. */
  SKIP_COLD_SCAN_CHECK?: true | undefined;
  /** For a statement carrying `{{idBound}}`: a time the caller has, and today's fallback. */
  idBound?: IdBoundOptions | undefined;
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
      /** The proof's expiry, checked before every statement: a held reader outlives no proof. */
      expiresAt?: number;
      now?: () => number;
    },
  ) {}

  /** The fence this reader applies, for a caller that must log or key on it. */
  get fence(): TenantFence {
    return this.deps.fence;
  }

  async query<Row = unknown>(params: ScopedQueryParams): Promise<{ json(): Promise<Row[]> }> {
    const { expiresAt, now } = this.deps;
    if (expiresAt !== undefined && expiresAt <= (now?.() ?? nowInstant().epochMilliseconds)) {
      throw new AuthorizationExpiredError(expiresAt);
    }
    const expanded = expandStatement({
      query: params.query,
      queryParams: params.query_params ?? {},
      fence: this.deps.fence,
    });
    const client = await this.resolvedClient();
    // The client expands an `{{idBound}}` marker, reading the index under this fence's tenants.
    const result = await client.query<Row>({
      tenantId: this.deps.tenantId,
      tenantIds: tenantsOf(this.deps.fence),
      sql: expanded.query,
      params: expanded.queryParams,
      ...(params.clickhouse_settings ? { settings: params.clickhouse_settings } : {}),
      ...(params.SKIP_COLD_SCAN_CHECK === true ? { SKIP_COLD_SCAN_CHECK: true } : {}),
      ...(params.idBound === undefined ? {} : { idBound: params.idBound }),
    });
    return { json: async () => result.rows };
  }

  private async resolvedClient(): Promise<ClickHouseQueryClient> {
    try {
      return await this.deps.client();
    } catch (cause: unknown) {
      throw new TenantReaderClientUnavailableError({ cause });
    }
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
  const bare = text.replace(MARKER, " ").replace(SET_MARKER, " ").replace(CONDITIONS_MARKER, " ");
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
  refuseUnappliedBraids({ fence, expanded });
  refuseOverBudget({ statement: expanded.text });
  return { query: expanded.text, queryParams: expanded.queryParams };
}

/**
 * Fails closed: a fence carrying braids applies their conditions only through the conditions
 * marker, so a statement or fragment the fence reaches without one is refused (ADR-185 §3).
 */
function refuseUnappliedBraids({
  fence,
  expanded,
}: {
  fence: TenantFence;
  expanded: { markers: number; conditioned: number };
}): void {
  if (fence.braids !== undefined && expanded.markers > 0 && expanded.conditioned === 0) {
    throw new StatementScopeError({ kind: "missing-condition-marker" });
  }
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
  refuseUnappliedBraids({ fence, expanded });
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
}): {
  text: string;
  queryParams: Record<string, unknown>;
  windowed: number;
  conditioned: number;
  markers: number;
} {
  let merged: Record<string, unknown> = { ...queryParams };
  let windowed = 0;
  let conditioned = 0;
  let sets = 0;
  const windowedBy =
    (render: typeof fenceExpression, counts: () => void) => (_match: string, column: string) => {
      if (!isTimeColumn(column)) {
        throw new StatementScopeError({ kind: "unknown-time-column", column });
      }
      windowed += 1;
      counts();
      const expression = render({ fence, column });
      merged = { ...merged, ...expression.params };
      return expression.sql;
    };
  const replaced = text
    .replace(
      MARKER,
      windowedBy(fenceExpression, () => {}),
    )
    .replace(
      CONDITIONS_MARKER,
      windowedBy(conditionsExpression, () => {
        conditioned += 1;
      }),
    )
    .replace(SET_MARKER, () => {
      sets += 1;
      const expression = setExpression(fence);
      merged = { ...merged, ...expression.params };
      return expression.sql;
    });
  return { text: replaced, queryParams: merged, windowed, conditioned, markers: windowed + sets };
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
      expiresAt: proof.expiresAt,
      now: () => this.deps.now?.() ?? nowInstant().epochMilliseconds,
    });
  }
}
