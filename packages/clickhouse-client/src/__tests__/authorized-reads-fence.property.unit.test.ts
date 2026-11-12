/**
 * ADR-201 v1.10: every generated proof, resource and statement is refused by name, or renders a
 * braid owner bound only in its own predicate clause under the held-trace semi-join on an honoured
 * span read, with every election AND-ed into its select, never under OR or NOT. Seeded.
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
const CASES = 4000;
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
/** What may sit just before an election: AND makes a conjunct; the rest put it under OR or NOT. */
const ELECTION_LEADS = [
  [" AND ", ""],
  [" AND TraceId = {traceId:String} AND ", ""],
  [" OR ", ""],
  [" AND TraceId = {traceId:String} OR ", ""],
  [" AND NOT ", ""],
  [" AND (1 = 1 OR ", ")"],
  [" AND (1 = 1 OR 1 = 2) OR ", ""],
  [" AND NOT (1 = 1 AND ", ")"],
] as const;

type StatementCase = {
  text: string;
  queryParams: Record<string, unknown>;
  fragment: boolean;
  held: HeldTraceBound | undefined;
};

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
  const conditions = () => tenantScopeWithConditions(column(), held);
  const election = () =>
    `${ELECTION_HEAD}${tenantScopeForLatestVersion(column())} GROUP BY TenantId, TraceId, SpanId)`;
  const outer = pick({
    random,
    from: [
      conditions,
      conditions,
      conditions,
      conditions,
      () => tenantScope(column()),
      tenantSet,
      () => tenantScopeForLatestVersion(column()),
      () => "1 = 1",
    ],
  })();
  const mixedElection = () => {
    const [lead, close] = pick({ random, from: ELECTION_LEADS });
    return `${lead}${ELECTION_TUPLE}${tenantScopeForLatestVersion(column())} GROUP BY TenantId, TraceId, SpanId)${close}`;
  };
  const extras = [
    () => election(),
    mixedElection,
    () => ` AND SpanId IN (SELECT SpanId FROM stored_spans WHERE 1 = 1${election()})`,
    () => ` AND TraceId IN (SELECT TraceId FROM trace_summaries WHERE ${tenantSet()})`,
    () => ` AND TraceId IN (SELECT TraceId FROM trace_summaries WHERE ${tenantScope(column())})`,
    () => ` AND SpanId IN (SELECT SpanId FROM stored_spans WHERE ${conditions()})`,
    () => " AND TenantId = {tenant:String}",
    () => " AND a.TenantId = b.TenantId",
  ].filter(() => chance({ random, p: 0.12 }));
  const body = `${outer}${extras.map((extra) => extra()).join("")}`;
  const fragment = chance({ random, p: 0.25 });
  const queryParams: Record<string, unknown> = { traceId: "tr-1", sinceMs: NOW - 60_000 };
  if (chance({ random, p: 0.05 }))
    queryParams[pick({ random, from: ["tenantScope_own", "idBound_x"] })] = "x";
  return {
    text: fragment ? body : `SELECT SpanId, SpanName FROM stored_spans WHERE ${body}`,
    queryParams,
    fragment,
    held,
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
  }
  return undefined;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
