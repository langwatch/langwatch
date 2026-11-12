/**
 * ADR-201 v1.10: every generated proof, resource and statement is refused by name, or renders a
 * braid owner bound only in its predicate clause under the held-trace semi-join on an honoured span
 * read, every election and marker AND-ed into its select's WHERE, never under OR or NOT. Seeded.
 */
import {
  AccessNotGrantedError,
  type Authorization,
  type AuthorizationInput,
  BRAID_CONDITION_EVERY_SPAN,
  type BraidConditionTerm,
  type CompiledWhere,
  honourSpanBraids,
  narrowAuthorization,
  sealAuthorization,
  SPAN_BRAID_PERMISSION,
} from "@langwatch/authorization";
import {
  type HeldTraceBound,
  TENANT_SCOPE_TIME_COLUMNS,
  tenantScope,
  tenantScopeForLatestVersion,
  tenantScopeWithConditions,
  tenantSet,
} from "@langwatch/clickhouse-markers";
import { describe, expect, it } from "vitest";

import {
  expandFragment,
  expandStatement,
  fenceFor,
  READ_RESOURCES,
  type ReadResource,
} from "../authorized-reads.ts";
import { StatementScopeError, type StatementScopeViolation } from "../statementScopeError.ts";

const SEED = 0x5eed_b4a1;
const CASES = 8000;
const NOW = 1_800_000_000_000;
const READER = "proj_reader";
const SECOND_OWN = "proj_reader_two";
const MEMBERS = ["proj_member_a", "proj_member_b"] as const;
const LOGGER = "proj_logger";
const OWNERS = ["proj_owner_a", "proj_owner_b", "proj_owner_c"] as const;
const PERMISSIONS = ["traces:view", "analytics:view", "cost:view"] as const;
const RESOURCES = Object.keys(READ_RESOURCES) as ReadResource[];
const KNOWN_REFUSALS: ReadonlySet<StatementScopeViolation["kind"]> = new Set([
  "missing-marker",
  "unknown-time-column",
  "hand-written-tenant-predicate",
  "reserved-param",
  "missing-condition-marker",
  "plain-marker-under-braids",
  "loose-latest-version-marker",
  "loose-tenant-marker",
  "shadowing-alias",
  "unfenced-select",
  "pinned-setting",
  "settings-under-braids",
  "unsupported-condition-version",
  "over-budget",
  "over-param-budget",
]);

type GrantInput = AuthorizationInput["grants"][number];

/** mulberry32: a small seeded generator, so a failing case reproduces from its index. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

type Random = ReturnType<typeof seededRandom>;
const chance = ({ random, p }: { random: Random; p: number }) => random() < p;
const pick = <T>({ random, from }: { random: Random; from: readonly T[] }): T => {
  if (from.length === 0) throw new Error("pick from an empty list");
  return from[Math.floor(random() * from.length)] as T;
};
const subsetOf = <T>({ random, from }: { random: Random; from: readonly T[] }): T[] =>
  from.filter(() => chance({ random, p: 0.6 }));

/** A literal no rendered statement may carry: every key and value is bound (ADR-201 §3). */
const literal = ({ random, part }: { random: Random; part: string }) =>
  `lit_${part}_${Math.floor(random() * 1e9)}`;

function termOf(random: Random): BraidConditionTerm {
  switch (pick({ random, from: ["equals", "name", "present", "verified"] as const })) {
    case "equals":
      return {
        kind: "attributeEquals",
        on: pick({ random, from: ["span", "resource"] as const }),
        key: literal({ random, part: "key" }),
        value: literal({ random, part: "value" }),
      };
    case "name":
      return { kind: "nameEquals", value: literal({ random, part: "name" }) };
    case "present":
      return { kind: "attributePresent", key: literal({ random, part: "key" }) };
    case "verified":
      return { kind: "verified", key: literal({ random, part: "signed" }) };
  }
}

function compiledWhereOf(random: Random): CompiledWhere {
  const terms = Array.from({ length: 1 + Math.floor(random() * 3) }, () => termOf(random));
  const [first] = terms;
  const tree = terms.length === 1 && first !== undefined ? first : { kind: "and" as const, terms };
  return { version: chance({ random, p: 0.15 }) ? 2 : 1, tree };
}

function windowOf(random: Random): { from: number; until: number | null } {
  const from = NOW - Math.floor(random() * 10) * 60_000;
  return { from, until: chance({ random, p: 0.5 }) ? null : from + 1 + Math.floor(random() * 1e6) };
}

/**
 * A braid's compiled form: a generated tree when `conditioned`, else every span stated, and now
 * and then none at all, which the seal must refuse.
 */
function braidCompiledWhereOf({
  random,
  conditioned,
}: {
  random: Random;
  conditioned: boolean;
}): CompiledWhere | undefined {
  if (conditioned) return compiledWhereOf(random);
  return chance({ random, p: 0.85 }) ? BRAID_CONDITION_EVERY_SPAN : undefined;
}

/** The generated grants, and whether a braid among them is malformed, which the seal refuses. */
function grantsOf({ random, conditioned }: { random: Random; conditioned: boolean }): {
  grants: GrantInput[];
  malformed: boolean;
} {
  const ownPermissions = chance({ random, p: 0.85 })
    ? [...new Set(["traces:view", ...subsetOf({ random, from: PERMISSIONS })])]
    : subsetOf({ random, from: PERMISSIONS });
  const grants: GrantInput[] = [
    { projectId: READER, permissions: ownPermissions, via: [], kind: "own" },
  ];
  if (chance({ random, p: 0.2 })) {
    grants.push({ projectId: SECOND_OWN, permissions: ["traces:view"], via: [], kind: "own" });
  }
  for (const member of MEMBERS.filter(() => chance({ random, p: 0.35 }))) {
    const condition = { type: "trace" as const, ...windowOf(random) };
    grants.push({
      projectId: member,
      permissions: subsetOf({ random, from: PERMISSIONS }),
      via: [`grant_${member}`],
      kind: "shared",
      condition,
    });
  }
  if (chance({ random, p: 0.2 })) {
    const condition = { type: "log" as const, ...windowOf(random) };
    grants.push({
      projectId: LOGGER,
      permissions: [...PERMISSIONS],
      via: ["grant_log"],
      kind: "shared",
      condition,
    });
  }
  const braids = Math.floor(random() * 4);
  let malformed = false;
  for (let index = 0; index < braids; index += 1) {
    const owner = pick({ random, from: OWNERS });
    const compiledWhere = braidCompiledWhereOf({ random, conditioned });
    // A braid carries the braid permission alone; now and then a read's own, which is refused.
    const ownPermission = chance({ random, p: 0.95 });
    const permissions = ownPermission
      ? [SPAN_BRAID_PERMISSION]
      : subsetOf({ random, from: PERMISSIONS });
    malformed ||= compiledWhere === undefined || !ownPermission;
    grants.push({
      projectId: owner,
      permissions,
      via: [`grant_${owner}_${index}`],
      kind: "shared",
      condition: {
        type: "span",
        ...(compiledWhere === BRAID_CONDITION_EVERY_SPAN ? {} : { where: "compiled" }),
        ...(compiledWhere === undefined ? {} : { compiledWhere }),
        ...windowOf(random),
      },
    });
  }
  return { grants, malformed };
}

type ProofCase = {
  authorization: Authorization;
  honoured: boolean;
  narrowedTo: string | undefined;
};

/** The seal refused a generated proof: a refusal only where a generated braid is malformed. */
class UnsealedProofError extends Error {}

function sealed({
  grants,
  malformed,
}: {
  grants: GrantInput[];
  malformed: boolean;
}): Authorization {
  try {
    return sealAuthorization({
      actor: { type: "user", id: "ana" },
      principal: { type: "user", id: "ana" },
      scope: { organizationId: "org_acme" },
      grants,
      expiresAt: NOW + 30_000,
      purpose: { kind: "route", route: "traces.get" },
    });
  } catch (cause) {
    if (!malformed) throw cause;
    throw new UnsealedProofError("the seal refused the proof", { cause });
  }
}

function proofOf({ random, conditioned }: { random: Random; conditioned: boolean }): ProofCase {
  const minted = sealed(grantsOf({ random, conditioned }));
  const honoured = chance({ random, p: 0.7 });
  const authorization = honoured ? honourSpanBraids({ authorization: minted }) : minted;
  const narrowedTo = chance({ random, p: 0.3 })
    ? pick({ random, from: [READER, SECOND_OWN, ...MEMBERS, LOGGER, ...OWNERS] })
    : undefined;
  if (narrowedTo === undefined) return { authorization, honoured, narrowedTo };
  return {
    authorization: narrowAuthorization({ authorization, projectId: narrowedTo }),
    honoured,
    narrowedTo,
  };
}

const COLUMNS = [...TENANT_SCOPE_TIME_COLUMNS, "NotATimeColumn"] as const;

const ELECTION_TUPLE =
  "(TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans WHERE ";
const ELECTION_HEAD = ` AND ${ELECTION_TUPLE}`;
/** What may sit around an election: AND makes a conjunct; the rest put it under OR or NOT, or
 *  compare or OR it from behind. */
const ELECTION_LEADS = [
  [" AND ", ""],
  [" AND TraceId = {traceId:String} AND ", ""],
  [" OR ", ""],
  [" AND TraceId = {traceId:String} OR ", ""],
  [" AND NOT ", ""],
  [" AND (1 = 1 OR ", ")"],
  [" AND (1 = 1 OR 1 = 2) OR ", ""],
  [" AND NOT (1 = 1 AND ", ")"],
  [" AND ", " = 0"],
  [" AND ", " OR 1 = 1"],
  [" AND ", " AND 1 = 1 OR 1 = 2"],
] as const;

/** Around a marker: AND-ed in a bracket stays a conjunct; the rest put it under OR, XOR or NOT. */
const MARKER_WRAPS = {
  conjunct: [
    ["(", " AND 1 = 1)"],
    ["1 = 1 AND ", ""],
  ],
  loose: [
    ["NOT ", ""],
    ["1 = 1 OR ", ""],
    ["", " OR 1 = 1"],
    ["(1 = 1 OR ", ")"],
    ["(", " OR 1 = 1)"],
    ["", " XOR 1 = 1"],
    ["not(", ")"],
    ["1 = 1 OR 1 = 1 AND ", ""],
  ],
} as const;

type StatementCase = {
  text: string;
  queryParams: Record<string, unknown>;
  fragment: boolean;
  held: HeldTraceBound | undefined;
  /** A marker was put under OR, XOR or NOT, or outside its WHERE: the fence must refuse it. */
  loose: boolean;
  /** An alias takes a name the fence reads, or a select reads a table past its own marker. */
  breaches: boolean;
};

/** What heads a statement's select list: a plain list, an alias the fence reads, a subquery. */
const PROJECTIONS = {
  plain: [""],
  breach: [
    "'proj_reader' AS TenantId, ",
    "map('orchestrator', 'web') AS SpanAttributes, ",
    "'proj_reader' TenantId, ",
    "'x' AS `SpanName`, ",
    "now() as starttime, ",
    "(SELECT any(SpanName) FROM stored_spans WHERE SpanId = {traceId:String}) AS n, ",
  ],
} as const;

/** What the outer select reads: the span table, or a second table joined or listed beside it. */
const SOURCES = {
  plain: ["stored_spans"],
  breach: [
    "stored_spans a JOIN stored_spans b ON a.TraceId = b.TraceId",
    "stored_spans, trace_summaries",
    "stored_spans a JOIN trace_summaries b USING (TraceId)",
  ],
} as const;

/** A random mix of every marker the fence reads, in shapes it accepts and shapes it refuses. */
function statementOf(random: Random): StatementCase {
  const column = () =>
    pick({ random, from: COLUMNS }) as (typeof TENANT_SCOPE_TIME_COLUMNS)[number];
  const held = pick({
    random,
    from: [
      undefined,
      undefined,
      { traceId: "traceId" },
      { traceId: "traceId" },
      { sinceMs: "sinceMs" },
      { sinceMs: "sinceMs" },
      { traceId: "tenantScope_own" },
    ] as const,
  });
  let loose = false;
  const placed = (marker: string): string => {
    const roll = random();
    if (roll >= 0.12) return marker;
    loose ||= roll < 0.08;
    const [lead, trail] = pick({
      random,
      from: roll < 0.08 ? MARKER_WRAPS.loose : MARKER_WRAPS.conjunct,
    });
    return `${lead}${marker}${trail}`;
  };
  const conditions = () => placed(tenantScopeWithConditions(column(), held));
  const latest = () => placed(tenantScopeForLatestVersion(column()));
  const election = () => `${ELECTION_HEAD}${latest()} GROUP BY TenantId, TraceId, SpanId)`;
  const outer = pick({
    random,
    from: [
      conditions,
      conditions,
      conditions,
      conditions,
      () => placed(tenantScope(column())),
      () => placed(tenantSet()),
      latest,
      () => "1 = 1",
    ],
  })();
  const mixedElection = () => {
    const [lead, close] = pick({ random, from: ELECTION_LEADS });
    return `${lead}${ELECTION_TUPLE}${latest()} GROUP BY TenantId, TraceId, SpanId)${close}`;
  };
  let breaches = false;
  const breach = (text: string): string => {
    breaches = true;
    return text;
  };
  const extras = [
    () => election(),
    mixedElection,
    () => breach(` AND SpanId IN (SELECT SpanId FROM stored_spans WHERE 1 = 1${election()})`),
    () => ` AND SpanId IN (SELECT SpanId FROM stored_spans WHERE ${conditions()}${election()})`,
    () => ` AND TraceId IN (SELECT TraceId FROM trace_summaries WHERE ${placed(tenantSet())})`,
    () =>
      ` AND TraceId IN (SELECT TraceId FROM trace_summaries WHERE ${placed(tenantScope(column()))})`,
    () => ` AND SpanId IN (SELECT SpanId FROM stored_spans WHERE ${conditions()})`,
    () => " AND TenantId = {tenant:String}",
    () => " AND a.TenantId = b.TenantId",
  ].filter(() => chance({ random, p: 0.12 }));
  // Now and then a select reading a table past the fence, or a union arm fenced on its own.
  const reads = [
    () => breach(" UNION ALL SELECT SpanId, SpanName FROM stored_spans WHERE 1 = 1"),
    () => ` UNION ALL SELECT SpanId, SpanName FROM stored_spans WHERE ${conditions()}`,
    () => breach(" AND TraceId IN trace_summaries"),
    () => breach(" UNION ALL SELECT toString(number), '' FROM numbers(10)"),
  ].filter(() => chance({ random, p: 0.04 }));
  // Now and then a marker in a clause that filters no row: HAVING, or the select list.
  const clause = pick({ random, from: [...Array<string>(14).fill("where"), "having", "select"] });
  const stray = pick({ random, from: [conditions, () => tenantScope(column()), tenantSet] });
  loose ||= clause !== "where";
  const having = clause === "having" ? ` GROUP BY SpanId HAVING ${stray()}` : "";
  const selected = clause === "select" ? `${stray()} AS fenced, ` : "";
  const fragment = clause !== "select" && chance({ random, p: 0.25 });
  const shaped = <T extends { plain: readonly string[]; breach: readonly string[] }>(from: T) =>
    !fragment && chance({ random, p: 0.08 })
      ? breach(pick({ random, from: from.breach }))
      : pick({ random, from: from.plain });
  const projection = shaped(PROJECTIONS);
  const source = shaped(SOURCES);
  const lead =
    !fragment && chance({ random, p: 0.02 }) ? breach("WITH 'proj_reader' AS TenantId ") : "";
  const tail = chance({ random, p: 0.03 })
    ? breach(" SETTINGS prefer_column_name_to_alias = 0")
    : "";
  const read = [...extras, ...reads].map((extra) => extra()).join("");
  const body = `${outer}${read}${having}${tail}`;
  const queryParams: Record<string, unknown> = { traceId: "tr-1", sinceMs: NOW - 60_000 };
  if (chance({ random, p: 0.05 }))
    queryParams[pick({ random, from: ["tenantScope_own", "idBound_x"] })] = "x";
  return {
    text: fragment
      ? body
      : `${lead}SELECT SpanId, ${projection}${selected}SpanName FROM ${source} WHERE ${body}`,
    queryParams,
    fragment,
    held,
    loose,
    breaches,
  };
}

/** The brackets open at `position`, innermost last; the rendered text holds no string literal. */
function enclosingGroups({ text, position }: { text: string; position: number }): number[] {
  const open: number[] = [];
  for (let index = 0; index < position; index += 1) {
    if (text[index] === "(") open.push(index);
    if (text[index] === ")") open.pop();
  }
  return open;
}

function closingOf({ text, open }: { text: string; open: number }): number {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`unbalanced bracket at ${open}`);
}

const HELD_PICK =
  "(TraceId IN (SELECT TraceId FROM stored_spans WHERE TenantId IN ({tenantScope_own:Array(String)})" +
  " AND StartTime >= fromUnixTimestamp64Milli({tenantScope_heldFrom:Int64})";
const ELECTION_GROUP = "(SELECT TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans WHERE ";

const narrowingOf = (held: HeldTraceBound | undefined): string => {
  if (held === undefined) return ")";
  if ("traceId" in held) return ` AND TraceId = {${held.traceId}:String})`;
  return ` AND StartTime >= fromUnixTimestamp64Milli({${held.sinceMs}:Int64}))`;
};

const slotsOf = ({ text, param }: { text: string; param: string }): number[] =>
  [...text.matchAll(new RegExp(`\\{${param}:`, "g"))].map((match) => match.index);

const bindsOwner = (value: unknown): boolean =>
  (OWNERS as readonly string[]).includes(String(value)) ||
  (Array.isArray(value) &&
    value.some((item) => (OWNERS as readonly string[]).includes(String(item))));

/** Where a braid owner bound by `param` may sit; a reason when it sits anywhere else. */
function ownerSlotViolation({
  text,
  param,
  held,
}: {
  text: string;
  param: string;
  held: HeldTraceBound | undefined;
}): string | undefined {
  const clause = /^tenantScope_c(\d+)_ids$/.exec(param);
  for (const position of slotsOf({ text, param })) {
    const groups = enclosingGroups({ text, position });
    if (param === "tenantScope_all") {
      if (!text.startsWith(`{${param}:Array(String)}) AND (`, position))
        return "the tenant set is not a conjunct";
      continue;
    }
    if (param === "tenantScope_ids") {
      if (!groups.some((open) => text.startsWith(ELECTION_GROUP, open)))
        return "a window outside an election";
      continue;
    }
    if (clause === null) return `an owner bound by ${param}`;
    const pickAt = groups.find((open) => text.startsWith(HELD_PICK, open));
    if (pickAt === undefined) return `clause ${clause[1]} outside the held-trace semi-join`;
    const semiJoinEnd = closingOf({ text, open: pickAt + "(TraceId IN ".length });
    const semiJoin = text.slice(0, semiJoinEnd + 1);
    const narrowing = narrowingOf(held);
    if (!semiJoin.endsWith(narrowing)) return "the semi-join is wider than the read";
    if (!text.startsWith(" AND (", semiJoinEnd + 1)) return "the semi-join is not a conjunct";
    const own = groups.findLast((open) => text.startsWith(`(TenantId IN ({${param}:`, open));
    const body = own === undefined ? "" : text.slice(own, closingOf({ text, open: own }));
    // "Every span" is stated as the always-true predicate; any other clause binds its terms.
    const everySpan = body.endsWith(" AND (1)");
    if (!everySpan && !/\{tenantScope_p\d+_[kv]:Array\(String\)\}\[\d+\]/.test(body))
      return `clause ${clause[1]} carries no predicate`;
  }
  return undefined;
}

/** Every rendered election must filter its select: a conjunct of that select's WHERE, AND-ed in. */
function electionViolation({ text }: { text: string }): string | undefined {
  for (const match of text.matchAll(new RegExp(escapeRegExp(ELECTION_TUPLE), "g"))) {
    const scopeStart = (enclosingGroups({ text, position: match.index }).at(-1) ?? -1) + 1;
    let scope = text.slice(scopeStart, match.index);
    for (let previous = ""; previous !== scope;) {
      previous = scope;
      scope = scope.replace(/\([^()]*\)/g, "G");
    }
    // A fragment is a WHERE's body: at its top level, the whole text before the election leads.
    const where = [...scope.matchAll(/\bWHERE\b/g)].at(-1);
    if (where === undefined && scopeStart > 0) return "an election inside a group of its WHERE";
    const lead = where === undefined ? scope : scope.slice(where.index + "WHERE".length);
    if (/\b(?:OR|NOT)\b/i.test(lead) || !/\bAND\s*$/.test(lead)) {
      return `an election that is not a conjunct: ${lead.slice(-40)}`;
    }
    const trail = trailOf({
      text,
      close: closingOf({ text, open: text.indexOf("(SELECT", match.index) }),
    });
    if (/\b(?:OR|NOT)\b/i.test(trail) || !/^\s*(?:AND\b|$)/i.test(trail)) {
      return `an election that is compared or OR-ed after it: ${trail.slice(0, 40)}`;
    }
  }
  return undefined;
}

/** What follows an election's close in its own scope, each nested group one `G`. */
function trailOf({ text, close }: { text: string; close: number }): string {
  let depth = 0;
  let trail = "";
  for (let index = close + 1; index < text.length; index += 1) {
    if (text[index] === ")" && depth === 0) break;
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") depth -= 1;
    else if (depth === 0) trail += text[index];
  }
  return trail;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names the fence reads, written out here so the oracle does not trust the reader's own list. */
const FENCE_COLUMNS = [
  "TenantId",
  "TraceId",
  "SpanId",
  "UpdatedAt",
  "SpanName",
  "SpanAttributes",
  "ResourceAttributes",
  ...TENANT_SCOPE_TIME_COLUMNS,
];
const SHADOWING_ALIAS = new RegExp(
  String.raw`(?:\bAS\s+|'\s+)[\`"]?(?:${FENCE_COLUMNS.join("|")})\b`,
  "i",
);

/** The select scope around `position`: its group, cut at UNION, with nested selects left out. */
function ownScopeOf({ text, position }: { text: string; position: number }): string {
  const open = enclosingGroups({ text, position }).at(-1);
  const end = open === undefined ? text.length : closingOf({ text, open });
  let scope = "";
  for (let index = open === undefined ? 0 : open + 1; index < end; index += 1) {
    if (/^\((?:SELECT|WITH)\b/.test(text.slice(index, index + 6))) {
      index = closingOf({ text, open: index });
      scope += " G ";
    } else if (text.startsWith(" UNION ", index) && index < position) {
      scope = "";
    } else if (text.startsWith(" UNION ", index)) {
      break;
    } else {
      scope += text[index];
    }
  }
  return scope;
}

/** Every select in the rendered text reading a table carries a fence expansion of its own. */
function unfencedReadViolation({ text }: { text: string }): string | undefined {
  for (const match of text.matchAll(/\bFROM\s+(?:stored_spans|trace_summaries|numbers)\b/g)) {
    if (!/\bTenantId IN \(\{tenantScope_/.test(ownScopeOf({ text, position: match.index }))) {
      return `a select reading a table with no fence of its own: ${text.slice(match.index, match.index + 60)}`;
    }
  }
  return undefined;
}

type Outcome =
  | { kind: "refused"; reason: string }
  | { kind: "rendered"; text: string; params: Record<string, unknown> };

function outcomeOf({ random, conditioned }: { random: Random; conditioned: boolean }): {
  outcome: Outcome;
  proof: ProofCase | undefined;
  reads: ReadResource;
  statement: StatementCase;
} {
  const reads = chance({ random, p: 0.5 }) ? "spans" : pick({ random, from: RESOURCES });
  const statement = statementOf(random);
  let proof: ProofCase | undefined;
  try {
    proof = proofOf({ random, conditioned });
    const fence = fenceFor({ authorization: proof.authorization, reads });
    const rendered = statement.fragment
      ? expandFragment({ fragment: statement.text, queryParams: statement.queryParams, fence })
      : (({ query, queryParams }) => ({ sql: query, params: queryParams }))(
          expandStatement({ query: statement.text, queryParams: statement.queryParams, fence }),
        );
    return {
      outcome: {
        kind: "rendered",
        text: rendered.sql,
        params: rendered.params,
      },
      proof,
      reads,
      statement,
    };
  } catch (error) {
    if (error instanceof StatementScopeError && KNOWN_REFUSALS.has(error.violation.kind)) {
      return {
        outcome: { kind: "refused", reason: error.violation.kind },
        proof,
        reads,
        statement,
      };
    }
    if (error instanceof UnsealedProofError) {
      return { outcome: { kind: "refused", reason: "unsealed" }, proof, reads, statement };
    }
    if (error instanceof AccessNotGrantedError) {
      return {
        outcome: { kind: "refused", reason: "access-not-granted" },
        proof,
        reads,
        statement,
      };
    }
    throw error;
  }
}

/** Every reason a rendered case breaks the property; empty when it holds. */
function violationsOf({
  outcome,
  proof,
  reads,
  statement,
}: ReturnType<typeof outcomeOf> & { outcome: Extract<Outcome, { kind: "rendered" }> }): string[] {
  const found: string[] = [];
  if (statement.loose) found.push("a marker under OR, XOR or NOT, or outside its WHERE, rendered");
  if (statement.breaches) found.push("a shadowing alias or a select past the fence, rendered");
  if (SHADOWING_ALIAS.test(outcome.text)) found.push("an alias the fence reads, rendered");
  const unfencedRead = unfencedReadViolation({ text: outcome.text });
  if (unfencedRead !== undefined) found.push(unfencedRead);
  const literals = outcome.text.match(/lit_[a-z]+_\d+/g);
  if (literals !== null) found.push(`condition literal in the text: ${literals[0]}`);
  const election = electionViolation({ text: outcome.text });
  if (election !== undefined) found.push(election);
  for (const [param, value] of Object.entries(outcome.params)) {
    if (!/^(?:tenantScope|idBound)/.test(param) || !bindsOwner(value)) continue;
    if (reads !== "spans" || proof?.honoured !== true)
      found.push(`owner bound on a ${reads} read, honoured ${String(proof?.honoured)}`);
    const reason = ownerSlotViolation({ text: outcome.text, param, held: statement.held });
    if (reason !== undefined) found.push(`${param}: ${reason}`);
  }
  return found;
}

function runProperty({ conditioned }: { conditioned: boolean }) {
  const random = seededRandom(conditioned ? SEED : SEED + 1);
  const tally = new Map<string, number>();
  const failures: string[] = [];
  for (let index = 0; index < CASES; index += 1) {
    const run = outcomeOf({ random, conditioned });
    if (run.outcome.kind === "refused") {
      tally.set(run.outcome.reason, (tally.get(run.outcome.reason) ?? 0) + 1);
      continue;
    }
    tally.set("rendered", (tally.get("rendered") ?? 0) + 1);
    if (Object.values(run.outcome.params).some(bindsOwner)) {
      tally.set("owner-bound", (tally.get("owner-bound") ?? 0) + 1);
    }
    const found = violationsOf({ ...run, outcome: run.outcome });
    if (found.length > 0 && failures.length < 5) {
      failures.push(
        `case ${index} (${run.reads}, narrowed ${String(run.proof?.narrowedTo)}): ${found.join("; ")}\n${run.outcome.text}`,
      );
    }
  }
  return { tally, failures };
}

/** Either budget needs the largest legal proof (its own test); a missing condition marker is
 *  refused earlier as a plain marker or a loose election. */
const UNREACHED: ReadonlySet<string> = new Set([
  "over-budget",
  "over-param-budget",
  "missing-condition-marker",
]);

describe("the fence, over generated proofs and statements", () => {
  describe("given braids whose condition is compiled", () => {
    it("binds a braid owner only in its predicate clause under the held-trace semi-join", () => {
      expect(runProperty({ conditioned: true }).failures).toEqual([]);
    });

    it("reaches every refusal and binds owners, so the property is not vacuous", () => {
      const { tally } = runProperty({ conditioned: true });
      for (const kind of [...KNOWN_REFUSALS].filter((reason) => !UNREACHED.has(reason))) {
        expect(tally.get(kind) ?? 0, `${kind} in ${JSON.stringify([...tally])}`).toBeGreaterThan(0);
      }
      expect(tally.get("access-not-granted") ?? 0).toBeGreaterThan(0);
      expect(tally.get("owner-bound") ?? 0).toBeGreaterThan(100);
      expect(tally.get("rendered") ?? 0).toBeGreaterThan(100);
    });
  });

  describe("given braids with no condition, stated as every span or left out", () => {
    // ADR-201 v1.10: a span condition always carries its compiled form, "every span" included.
    it("never reads an owner's spans outside the held-trace semi-join", () => {
      expect(runProperty({ conditioned: false }).failures).toEqual([]);
    });

    it("renders every-span braids and refuses the ones with no compiled form when sealed", () => {
      const { tally } = runProperty({ conditioned: false });

      expect(tally.get("owner-bound") ?? 0).toBeGreaterThan(100);
      expect(tally.get("unsealed") ?? 0).toBeGreaterThan(0);
    });
  });
});
