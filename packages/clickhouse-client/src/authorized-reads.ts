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
  honouredSpanBraidGrants,
  type ProofBearingPermission,
  type SharedWindow,
  sharedWindowsReadBy,
  SPAN_BRAID_PERMISSION,
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
import {
  ID_BOUND_PARAM_PREFIX,
  StatementScopeError,
  TENANT_SCOPE_PARAM_PREFIX,
} from "./statementScopeError.ts";

/** Resolves the routed client a project's reads are sent through. */
export type ClickHouseClientResolver = (tenantId: string) => Promise<ClickHouseQueryClient>;

/** Whether a shared grant's window of one condition type opens a read; there is no default. */
type WindowTreatment = "applies" | "excluded";

/**
 * A reader's proof-bearing permission and its treatment of every condition type's window, so a
 * new resource or condition type does not compile until someone chooses. Only `spans` takes
 * `span` windows, those of grants carrying `spans:braided`; a guard test holds both (ADR-201 §3).
 */
export const READ_RESOURCES = {
  traces: {
    permission: "traces:view",
    windows: { trace: "applies", span: "excluded", log: "excluded" },
  },
  analytics: {
    permission: "analytics:view",
    windows: { trace: "applies", span: "excluded", log: "excluded" },
  },
  cost: {
    permission: "cost:view",
    windows: { trace: "applies", span: "excluded", log: "excluded" },
  },
  spans: {
    permission: "traces:view",
    windows: { trace: "applies", span: "applies", log: "excluded" },
  },
} as const satisfies Record<
  string,
  {
    permission: ProofBearingPermission;
    windows: { readonly [Type in AuthorizationConditionType]: WindowTreatment };
  }
>;
export type ReadResource = keyof typeof READ_RESOURCES;

const MARKER = /\{\{tenantScope:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const SET_MARKER = /\{\{tenantSet\}\}/g;
const CONDITIONS_MARKER =
  /\{\{tenantScopeWithConditions:([A-Za-z_][A-Za-z0-9_]*)(?::(traceId|sinceMs)=([A-Za-z_][A-Za-z0-9_]*))?\}\}/g;
const LATEST_VERSION_MARKER = /\{\{tenantScopeForLatestVersion:([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
/** A fence marker that windows its select: the latest-version election must sit in its WHERE. */
const WINDOWED_MARKER = /\{\{tenantScope(?:WithConditions)?:[^}]*\}\}/g;
/** The one shape a latest-version marker may follow; its select names keys and versions only. */
const ELECTION_HEAD =
  /\(\s*TenantId\s*,\s*TraceId\s*,\s*SpanId\s*,\s*UpdatedAt\s*\)\s+IN\s*\(\s*SELECT\s+TenantId\s*,\s*TraceId\s*,\s*SpanId\s*,\s*max\(\s*UpdatedAt\s*\)\s+FROM\s+stored_spans\s+WHERE\s+$/i;

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
 * One bracketed clause of the conditions marker: a trace window read beside braids, or owners
 * and their windows under one braid's compiled predicate ("every span" stated). An owner sits
 * once per clause; a second disjoint window under one predicate goes in a clause of its own.
 */
type BraidClause = { digest: string; windows: readonly SharedWindow[] } & (
  | { kind: "traceWindow" }
  | { kind: "braid"; compiledWhere: CompiledWhere }
);

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

/** The statement parameter a conditions marker names to narrow its held-trace semi-join. */
type HeldTraceParam = { kind: "traceId" | "sinceMs"; param: string };

/**
 * The conditions marker (ADR-201 §3): own projects outright, OR one clause per distinct predicate
 * holding its owners' windows AND the predicate, every key and literal bound, the braid clauses
 * only in traces an own project holds. The `OR` is the fence's, under its exact tenant set.
 */
export function conditionsExpression({
  fence,
  column,
  held,
}: {
  fence: TenantFence;
  column: TenantScopeTimeColumn;
  held?: HeldTraceParam | undefined;
}): { sql: string; params: Record<string, unknown> } {
  const { braids } = fence;
  if (braids === undefined) return fenceExpression({ fence, column });
  const params: Record<string, unknown> = {
    [fenceParam("all")]: tenantsOf(fence),
    [fenceParam("own")]: [...fence.own],
  };
  const picks: string[] = [];
  if (fence.own.length > 0) picks.push(`TenantId IN (${slot("own", "Array(String)")})`);
  const braided: string[] = [];
  braids.clauses.forEach((clause, index) => {
    const name = (part: string) => `c${index}_${part}`;
    const windowed = windowsOf({ column, windows: clause.windows, name });
    Object.assign(params, windowed.params);
    if (clause.kind === "traceWindow") {
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
    braided.push(`(${windowed.sql} AND (${predicate.sql}))`);
  });
  if (braided.length > 0) {
    params[fenceParam("heldFrom")] = Math.min(
      ...braids.clauses
        .filter((clause) => clause.kind === "braid")
        .flatMap((clause) => clause.windows.map((window) => window.from)),
    );
    picks.push(`(${heldTraceOf(held)} AND (${braided.join(" OR ")}))`);
  }
  return {
    sql: `(TenantId IN (${slot("all", "Array(String)")}) AND (${picks.join(" OR ")}))`,
    params,
  };
}

/**
 * The traces an own project holds: one semi-join on `stored_spans` from the earliest braid
 * window's start, narrowed by the read's trace id or its own lower bound so it reads no wider than
 * the outer read (ADR-201 §3). The fence binds the tenants; a statement names only its bound.
 */
function heldTraceOf(held: HeldTraceParam | undefined): string {
  let narrowed = "";
  if (held?.kind === "traceId") narrowed = ` AND TraceId = {${held.param}:String}`;
  if (held?.kind === "sinceMs") {
    narrowed = ` AND StartTime >= fromUnixTimestamp64Milli({${held.param}:Int64})`;
  }
  return (
    `TraceId IN (SELECT TraceId FROM stored_spans WHERE TenantId IN (${slot("own", "Array(String)")})` +
    ` AND StartTime >= fromUnixTimestamp64Milli(${slot("heldFrom", "Int64")})${narrowed})`
  );
}

/**
 * A compiled condition rendered for a statement of a module's own, the braid preview's
 * (ADR-201 §7): the fence's conjunction, every key and literal bound under `prefix`, and
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
  const terms = braidConditionTermsOf(compiledWhere.tree);
  // "Every span" is the empty conjunction, which is true.
  const sql = terms.length === 0 ? "1" : terms.map(termSql).join(" AND ");
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
  const { permission, windows } = READ_RESOURCES[reads];
  const applies = (type: AuthorizationConditionType): boolean => windows[type] === "applies";
  // A braid carries `spans:braided` alone, so no resource reading `permission` picks one up.
  const braids = (grant: AuthorizationGrant) => grant.permissions.includes(SPAN_BRAID_PERMISSION);
  const carries = (grant: AuthorizationGrant) => grant.permissions.includes(permission);
  const own = authorization.grants
    .filter((grant) => grant.kind === "own" && grant.projectId !== undefined)
    .filter(carries)
    .map((grant) => grant.projectId as string);
  if (own.length === 0) throw new AccessNotGrantedError(permission);
  const shared = applies("trace")
    ? sharedWindowsReadBy({ authorization, permission, condition: "trace" })
    : [];
  // A braid reaches the fence only on a proof the plan check honoured (ADR-201 §9).
  const braided = applies("span") ? honouredSpanBraidGrants(authorization).filter(braids) : [];
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
  // Braids read into the own project's traces, so only narrowing to it keeps them (ADR-201 §5).
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
  const byPredicate = new Map<string, BraidClause>();
  const add = (clause: BraidClause, window: SharedWindow) => {
    const held = byPredicate.get(clause.digest) ?? clause;
    byPredicate.set(clause.digest, { ...held, windows: [...held.windows, window] });
  };
  for (const grant of braided) {
    const compiledWhere = compiledWhereOf(grant);
    const digest = braidConditionDigest(compiledWhere);
    add({ kind: "braid", compiledWhere, digest, windows: [] }, windowOf(grant));
  }
  // A trace window read beside braids is a clause of its own, with no predicate.
  for (const window of fence.shared) add({ kind: "traceWindow", digest: "", windows: [] }, window);
  const clauses = [...byPredicate.values()].flatMap(layeredByOwner);
  const widest = mergedByOwner(braided.map(windowOf)).map(hullOf);
  return { ...fence, shared: [...fence.shared, ...widest], braids: { reader, clauses } };
}

/**
 * A braid's compiled form, refused when absent or from another compiler version: "every span" is
 * stated, never implied by a missing form, so the fence fails closed (ADR-201 §3).
 */
function compiledWhereOf(grant: AuthorizationGrant): CompiledWhere {
  const compiledWhere = grant.condition?.compiledWhere;
  if (compiledWhere === undefined) {
    throw new StatementScopeError({ kind: "uncompiled-braid-condition" });
  }
  if (compiledWhere.version !== BRAID_CONDITION_COMPILER_VERSION) {
    throw new StatementScopeError({
      kind: "unsupported-condition-version",
      version: compiledWhere.version,
    });
  }
  return compiledWhere;
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
  /** False when the statement's own time cap is its answer; see `QueryRequest`. */
  retryOnTimeout?: false | undefined;
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
      ...(params.retryOnTimeout === false ? { retryOnTimeout: false } : {}),
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
  const bare = text
    .replace(MARKER, " ")
    .replace(SET_MARKER, " ")
    .replace(CONDITIONS_MARKER, " ")
    .replace(LATEST_VERSION_MARKER, " ");
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
  refuseUnconditionedMarkers({ text: query, fence });
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
 * marker, so a statement or fragment the fence reaches without one is refused (ADR-201 §3).
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
 * Owner rows leave only through the conditions marker (ADR-201 §3): under braids a plain marker
 * is refused, and a latest-version marker is accepted only as the election AND-ed into the WHERE
 * of a select a windowed marker fences, so its keys filter that select and are never read.
 */
function refuseUnconditionedMarkers({ text, fence }: { text: string; fence: TenantFence }): void {
  if (
    fence.braids !== undefined &&
    (text.search(MARKER) !== -1 || text.search(SET_MARKER) !== -1)
  ) {
    throw new StatementScopeError({ kind: "plain-marker-under-braids" });
  }
  for (const election of text.matchAll(LATEST_VERSION_MARKER)) {
    const before = text.slice(0, election.index);
    const head = ELECTION_HEAD.exec(before);
    const outer = head === null ? "" : before.slice(0, head.index);
    const fenced = [...outer.matchAll(WINDOWED_MARKER)].at(-1);
    const between = fenced === undefined ? undefined : outer.slice(fenced.index + fenced[0].length);
    if (between === undefined || !isConjunctionLeadingIn({ text: between })) {
      throw new StatementScopeError({ kind: "loose-latest-version-marker" });
    }
  }
}

/** A term the election may be AND-ed after: an operand, or two compared; a group is one operand. */
const CONJUNCT_OPERAND = String.raw`(?:[A-Za-z_][\w.]*\s*)?§G|[A-Za-z_][\w.]*|\d+(?:\.\d+)?|§P`;
const CONJUNCT_TERM = new RegExp(
  String.raw`^\s*(?:${CONJUNCT_OPERAND})\s*(?:(?:=|!=|<>|<=|>=|<|>|\bIN\b)\s*(?:${CONJUNCT_OPERAND})\s*)?$`,
  "i",
);

/**
 * Allow-listed: the text from the windowed marker to the election is ` AND term AND term ... AND`,
 * so the election is a conjunct of that WHERE, never an OR arm, under a NOT, or inside a group.
 * Markers, parameters and quoted text are one operand each; a comment or a subquery refuses.
 */
function isConjunctionLeadingIn({ text }: { text: string }): boolean {
  if (/--|\/\*|#|;|\b(?:SELECT|FROM|UNION)\b/i.test(text)) return false;
  let flat = text
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/\{[^{}]*\}/g, " §P ")
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, " §P ");
  if (/['"`{}]/.test(flat)) return false;
  for (let previous = ""; previous !== flat;) {
    previous = flat;
    flat = flat.replace(/\([^()]*\)/g, " §G ");
  }
  if (/[()]/.test(flat) || /\b(?:OR|NOT|XOR)\b/i.test(flat)) return false;
  const terms = flat.split(/\bAND\b/i);
  const first = terms.shift();
  const last = terms.pop();
  if (first?.trim() !== "" || last?.trim() !== "") return false;
  return terms.every((term) => CONJUNCT_TERM.test(term));
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
  refuseUnconditionedMarkers({ text: fragment, fence });
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
  let elections = 0;
  const windowedBy =
    (render: typeof conditionsExpression, counts: () => void) =>
    (_match: string, column: string, ...groups: unknown[]) => {
      if (!isTimeColumn(column)) {
        throw new StatementScopeError({ kind: "unknown-time-column", column });
      }
      // Only the conditions marker captures a bound; the others pass the offset here.
      const [kind, param] = groups;
      const held: HeldTraceParam | undefined =
        (kind === "traceId" || kind === "sinceMs") && typeof param === "string"
          ? { kind, param }
          : undefined;
      if (held !== undefined && reservesPrefix(held.param)) {
        throw new StatementScopeError({ kind: "reserved-param", param: held.param });
      }
      counts();
      const expression = render({ fence, column, held });
      merged = { ...merged, ...expression.params };
      return expression.sql;
    };
  const replaced = text
    .replace(
      MARKER,
      windowedBy(fenceExpression, () => {
        windowed += 1;
      }),
    )
    .replace(
      CONDITIONS_MARKER,
      windowedBy(conditionsExpression, () => {
        windowed += 1;
        conditioned += 1;
      }),
    )
    .replace(
      LATEST_VERSION_MARKER,
      windowedBy(fenceExpression, () => {
        elections += 1;
      }),
    )
    .replace(SET_MARKER, () => {
      sets += 1;
      const expression = setExpression(fence);
      merged = { ...merged, ...expression.params };
      return expression.sql;
    });
  return {
    text: replaced,
    queryParams: merged,
    windowed,
    conditioned,
    markers: windowed + elections + sets,
  };
}

const reservesPrefix = (param: string): boolean =>
  param.startsWith(TENANT_SCOPE_PARAM_PREFIX) || param.startsWith(ID_BOUND_PARAM_PREFIX);

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
      // Only a braid's read is cut at expiry: a long export on any other proof keeps its reader.
      ...(fence.braids === undefined ? {} : { expiresAt: proof.expiresAt }),
      now: () => this.deps.now?.() ?? nowInstant().epochMilliseconds,
    });
  }
}
