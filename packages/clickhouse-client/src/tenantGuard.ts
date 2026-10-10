/**
 * Refuses a statement that is not scoped to exactly one tenant.
 */

import type { InsertRequest, QueryRequest } from "./query.ts";
import { quietly } from "./resilience.ts";

export type TenantScopeViolation =
  | { kind: "missing-predicate" }
  | { kind: "literal-predicate" }
  | { kind: "weakening-disjunction" }
  | { kind: "negated-predicate" }
  | { kind: "predicate-not-and-term" }
  | { kind: "unbound-read" }
  | { kind: "missing-param"; param: string }
  | {
      kind: "param-mismatch";
      param: string;
      expected: string;
      actual: unknown;
    }
  | { kind: "tenant-set-mismatch"; declared: readonly string[]; bound: readonly unknown[] }
  | { kind: "tenant-set-spans-organizations"; organizations: readonly string[] }
  | { kind: "missing-row-tenant"; row: number }
  | { kind: "row-tenant-mismatch"; row: number; actual: unknown };

/** `TenantId = {someName:String}`, allowing an optional table alias. */
const BOUND_TENANT_PREDICATE = /(?:^|[\s.(])TenantId\s*=\s*\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/i;

/**
 * A declared tenant set's placeholders only: `TenantId IN ({a:String}, {b:String})` (group 1) or
 * one `TenantId IN ({p:Array(String)})` parameter (group 2, M8487-GUARD-ARRAY).
 */
const BOUND_TENANT_SET =
  /(?:^|[\s.(])TenantId\s+IN\s*\(\s*(?:(\{\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*String\s*\}(?:\s*,\s*\{\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*String\s*\})*)|\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*Array\(\s*String\s*\)\s*\})\s*\)/i;

const PLACEHOLDER_NAME = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g;

/** `TenantId = 'literal'` or `= "literal"`, which is never acceptable. */
const LITERAL_TENANT_PREDICATE = /(?:^|[\s.(])TenantId\s*=\s*(?:'[^']*'|"[^"]*")/i;

/**
 * Blanks out comment bodies and string-literal bodies, keeping every other character at its
 * original index.
 */
function maskNonCode(sql: string): string {
  const out = sql.split("");
  let cursor = 0;
  while (cursor < sql.length) {
    const commentEnd = commentEndAt(sql, cursor);
    if (commentEnd !== cursor) {
      blankRange({ out, from: cursor, to: commentEnd });
      cursor = commentEnd;
      continue;
    }

    const quote = sql[cursor];
    if (quote === "'" || quote === '"' || quote === "`") {
      const scan = closingQuoteAt(sql, cursor);
      // The delimiters stay, so `TenantId = 'x'` is still recognisably a
      // literal predicate rather than becoming a bare `TenantId =`.
      blankRange({ out, from: cursor + 1, to: Math.min(scan, sql.length) });
      cursor = Math.min(scan + 1, sql.length);
      continue;
    }

    cursor += 1;
  }

  return out.join("");
}

function blankRange({ out, from, to }: { out: string[]; from: number; to: number }): void {
  for (let i = from; i < to && i < out.length; i++) {
    if (out[i] !== "\n") out[i] = " ";
  }
}

/**
 * Where a comment or heredoc starting at `cursor` ends, as ClickHouse lexes it; `cursor` itself
 * when none starts there (GUARD-F1-F3).
 */
function commentEndAt(sql: string, cursor: number): number {
  const pair = sql.slice(cursor, cursor + 2);
  if (pair === "/*") return blockCommentEndAt(sql, cursor);
  if (pair === "--" || pair === "# " || pair === "#!") {
    const newline = sql.indexOf("\n", cursor);
    return newline === -1 ? sql.length : newline;
  }
  if (pair.startsWith("$")) return heredocEndAt(sql, cursor);
  return cursor;
}

/** ClickHouse nests block comments: one closes only once every opener inside it has closed. */
function blockCommentEndAt(sql: string, open: number): number {
  let depth = 0;
  let scan = open;
  while (scan < sql.length) {
    const pair = sql.slice(scan, scan + 2);
    if (pair !== "/*" && pair !== "*/") {
      scan += 1;
      continue;
    }
    depth += pair === "/*" ? 1 : -1;
    scan += 2;
    if (depth === 0) return scan;
  }
  return sql.length;
}

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[A-Za-z0-9_]/.test(character);

/** A `$tag$ ... $tag$` string; a `$` inside an identifier such as `a$b$` opens none. */
function heredocEndAt(sql: string, cursor: number): number {
  const previous = sql[cursor - 1];
  if (previous === "$" || isWordCharacter(previous)) return cursor;
  let tagEnd = cursor + 1;
  while (isWordCharacter(sql[tagEnd])) tagEnd += 1;
  if (sql[tagEnd] !== "$") return cursor;
  const tag = sql.slice(cursor, tagEnd + 1);
  const close = sql.indexOf(tag, tagEnd + 1);
  return close === -1 ? cursor : close + tag.length;
}

/** Where the literal opened at `open` closes; backslash and doubled quotes escape. */
function closingQuoteAt(sql: string, open: number): number {
  const quote = sql[open];
  let scan = open + 1;
  while (scan < sql.length) {
    if (sql[scan] === "\\") {
      scan += 2;
      continue;
    }
    if (sql[scan] !== quote) {
      scan += 1;
      continue;
    }
    // A doubled quote is an escaped quote, not the end of the literal.
    if (sql[scan + 1] !== quote) return scan;
    scan += 2;
  }
  return scan;
}

/**
 * Whether an `\bOR\b` token, by hand, starts at `masked[i]` (so `ORDER BY`
 * and `colour` are not ORs).
 */
function isOrTokenAt(masked: string, i: number): boolean {
  const character = masked[i];
  if (character !== "o" && character !== "O") return false;
  if (masked[i + 1] !== "r" && masked[i + 1] !== "R") return false;
  if (isWordCharacter(masked[i - 1])) return false;
  return !isWordCharacter(masked[i + 2]);
}

/** Any tenant predicate an `OR` could disjoin away: bound, literal or a tenant set. */
const ANY_TENANT_PREDICATE = /(?:^|[\s.(])TenantId\s*(?:=\s*[{'"]|IN\s*\(\s*\{)/gi;

/** Where `TenantId` itself starts in a match whose first character may be a separator. */
const tokenIndex = (match: RegExpExecArray): number => match.index + match[0].search(/TenantId/i);

const matchesOf = ({ pattern, masked }: { pattern: RegExp; masked: string }): RegExpExecArray[] => [
  ...masked.matchAll(new RegExp(pattern.source, "gi")),
];

/** Each character's bracket group, each group's parent and brackets; the statement is group 0. */
function bracketGroups(masked: string): {
  groupAt: Int32Array;
  parent: number[];
  balanced: boolean;
  opens: number[];
  closes: number[];
} {
  const groupAt = new Int32Array(masked.length);
  const parent = [-1];
  const opens = [-1];
  const closes: number[] = [];
  const open = [0];
  let balanced = true;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "(") {
      parent.push(open.at(-1) ?? 0);
      opens.push(i);
      open.push(parent.length - 1);
    } else if (masked[i] === ")") {
      if (open.length === 1) balanced = false;
      else closes[open.pop() ?? 0] = i;
    }
    groupAt[i] = open.at(-1) ?? 0;
  }
  return { groupAt, parent, balanced: balanced && open.length === 1, opens, closes };
}

const encloses = ({ parent, outer, inner }: { parent: number[]; outer: number; inner: number }) => {
  for (let group = inner; group !== -1; group = parent[group] ?? -1) {
    if (group === outer) return true;
  }
  return false;
};

/** Each `OR` token's index and bracket depth, and the depth at `predicateIndex`. */
function disjunctionsOf({ masked, predicateIndex }: { masked: string; predicateIndex: number }): {
  disjunctions: { index: number; depth: number }[];
  predicateDepth: number;
} {
  const disjunctions: { index: number; depth: number }[] = [];
  let depth = 0;
  let predicateDepth = 0;

  for (let i = 0; i < masked.length; i++) {
    if (i === predicateIndex) predicateDepth = depth;

    const character = masked[i];
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character === ")") {
      depth -= 1;
      continue;
    }

    if (isOrTokenAt(masked, i)) {
      disjunctions.push({ index: i, depth });
    }
  }

  return { disjunctions, predicateDepth };
}

/** A bracket holding a `SELECT` of its own is a subquery's (GUARD-FOLLOWUPS R2). */
const SELECT_TOKEN = /\bSELECT\b/i;

/** Whether a subquery's bracket lies between `inner` and the group `outer` enclosing it. */
function throughSubquery({
  parent,
  subqueries,
  outer,
  inner,
}: {
  parent: number[];
  subqueries: ReadonlySet<number>;
  outer: number;
  inner: number;
}): boolean {
  for (let group = inner; group !== outer && group !== -1; group = parent[group] ?? -1) {
    if (subqueries.has(group)) return true;
  }
  return false;
}

/**
 * Reports an `OR` that can disjoin a tenant predicate away (in or enclosing its group), unless
 * beneath a fencing set, enclosing none, with no subquery between (else refused). An `OR` reaching
 * none in its own scope is left to the unbound-read check (WEB-985, WEB-5300). Unbalanced: depth.
 */
function hasWeakeningDisjunction({
  masked,
  predicateIndex,
  fencingIndexes = [],
}: {
  masked: string;
  predicateIndex: number;
  fencingIndexes?: readonly number[];
}): boolean {
  const { disjunctions, predicateDepth } = disjunctionsOf({ masked, predicateIndex });
  const { groupAt, parent, balanced } = bracketGroups(masked);
  if (!balanced) return disjunctions.some((each) => each.depth <= predicateDepth);

  const groupOf = (index: number): number => groupAt[index] ?? 0;
  const tenantGroups = matchesOf({ pattern: ANY_TENANT_PREDICATE, masked }).map((match) =>
    groupOf(tokenIndex(match)),
  );
  const fencingGroups = fencingIndexes.map(groupOf);
  const subqueries = new Set(
    matchesOf({ pattern: SELECT_TOKEN, masked }).map((match) => groupOf(match.index)),
  );
  const fencesOf = (group: number): number[] =>
    fencingGroups.filter((outer) => encloses({ parent, outer, inner: group }));
  const inSubqueryBeneathFence = (group: number): boolean =>
    fencesOf(group).some((outer) => throughSubquery({ parent, subqueries, outer, inner: group }));
  const fenced = (group: number): boolean =>
    !fencingGroups.some((inner) => encloses({ parent, outer: group, inner })) &&
    fencesOf(group).length > 0;

  return disjunctions.some((each) => {
    const group = groupOf(each.index);
    if (inSubqueryBeneathFence(group)) return true;
    if (fenced(group)) return false;
    // A predicate inside a subquery scopes only that subquery's read; an outer OR cannot reach it.
    return tenantGroups.some(
      (inner) =>
        encloses({ parent, outer: group, inner }) &&
        !throughSubquery({ parent, subqueries, outer: group, inner }),
    );
  });
}

/** `NOT` followed by `TenantId`, bare or alias-qualified (GUARD-FOLLOWUPS R3). */
const NEGATION = /\bNOT\b\s*/i;
const TENANT_OPERAND = /^(?:[A-Za-z_][A-Za-z0-9_]*\s*\.\s*)?TenantId\b/i;
const TENANT_TOKEN = /(?<![A-Za-z0-9_])TenantId(?![A-Za-z0-9_])/i;

/** Whether a `NOT` (or `not(`) negates `TenantId` itself or a bracket that names it. */
function hasNegatedPredicate(masked: string): boolean {
  const { groupAt, parent } = bracketGroups(masked);
  const tenantGroups = matchesOf({ pattern: TENANT_TOKEN, masked }).map(
    (match) => groupAt[match.index] ?? 0,
  );
  return matchesOf({ pattern: NEGATION, masked }).some((match) => {
    const operand = match.index + match[0].length;
    if (masked[operand] !== "(") return TENANT_OPERAND.test(masked.slice(operand));
    const group = groupAt[operand] ?? 0;
    return tenantGroups.some((inner) => encloses({ parent, outer: group, inner }));
  });
}

/** What a tenant predicate, or a plain bracket holding it, may follow and precede (GUARD-F1-F3). */
const CONJUNCT_BEFORE = new Set(["WHERE", "PREWHERE", "HAVING", "ON", "AND", "("]);
const CONJUNCT_AFTER = new Set(
  "AND ) ; WHERE GROUP ORDER LIMIT SETTINGS FORMAT HAVING WINDOW QUALIFY UNION EXCEPT INTERSECT"
    .concat(" JOIN INNER LEFT RIGHT FULL CROSS ARRAY ANY")
    .split(" "),
).add("");
const CONJUNCT_SCOPE = /\b(?:AND|BETWEEN|WHERE|PREWHERE|HAVING|ON)\b/i;

/** The word or single character ending before `index`, whitespace skipped; "" at the start. */
function tokenBefore(masked: string, index: number): { text: string; start: number } {
  let end = index;
  while (end > 0 && /\s/.test(masked.charAt(end - 1))) end -= 1;
  let start = Math.max(end - 1, 0);
  if (isWordCharacter(masked[start])) while (isWordCharacter(masked[start - 1])) start -= 1;
  return { text: masked.slice(start, end).toUpperCase(), start };
}

type Token = { text: string; start: number; end: number };

/** The word or single character starting at or after `index`, whitespace skipped; "" at the end. */
function nextToken(masked: string, index: number): Token {
  let start = index;
  while (start < masked.length && /\s/.test(masked.charAt(start))) start += 1;
  let end = Math.min(start + 1, masked.length);
  if (isWordCharacter(masked[start])) while (isWordCharacter(masked[end])) end += 1;
  return { text: masked.slice(start, end), start, end };
}

const tokenAfter = (masked: string, index: number): string =>
  nextToken(masked, index).text.toUpperCase();

/** A bound predicate's span: from its table alias, if any, to just past its value. */
function predicateSpan({ masked, match }: { masked: string; match: RegExpExecArray }) {
  const tenant = tokenIndex(match);
  const qualifier = tokenBefore(masked, tenant);
  const from = qualifier.text === "." ? tokenBefore(masked, qualifier.start).start : tenant;
  const matched = match.index + match[0].length;
  const to = masked[matched - 1] === ")" ? matched : masked.indexOf("}", matched) + 1;
  return { from, to };
}

type TermLevel = {
  masked: string;
  groupAt: Int32Array;
  ternaries: ReadonlySet<number>;
  scopeWords: readonly RegExpExecArray[];
};

/** Whether the `AND` at `and` is a `BETWEEN`'s, not a conjunction's. */
function isBetweenBound({ level, and }: { level: TermLevel; and: number }): boolean {
  const group = level.groupAt[and];
  const previous = level.scopeWords
    .filter((word) => word.index < and && level.groupAt[word.index] === group)
    .at(-1);
  return previous?.[0].toUpperCase() === "BETWEEN";
}

/** Whether `[from, to)` sits between words that leave its result as it is, in `group`. */
function isPlainTerm({
  level,
  from,
  to,
  group,
}: {
  level: TermLevel;
  from: number;
  to: number;
  group: number;
}): boolean {
  const before = tokenBefore(level.masked, from);
  if (!CONJUNCT_BEFORE.has(before.text)) return false;
  if (!CONJUNCT_AFTER.has(tokenAfter(level.masked, to))) return false;
  if (level.ternaries.has(group)) return false;
  return before.text !== "AND" || !isBetweenBound({ level, and: before.start });
}

type Shape = TermLevel &
  ReturnType<typeof bracketGroups> & {
    subqueries: ReadonlySet<number>;
  };

function shapeOf(masked: string): Shape {
  const groups = bracketGroups(masked);
  const groupsOf = (pattern: RegExp) =>
    new Set(matchesOf({ pattern, masked }).map((found) => groups.groupAt[found.index] ?? 0));
  return {
    ...groups,
    masked,
    subqueries: groupsOf(SELECT_TOKEN),
    ternaries: groupsOf(/\?/),
    scopeWords: matchesOf({ pattern: CONJUNCT_SCOPE, masked }),
  };
}

/**
 * Where a predicate reaches its clause (or subquery) through `AND` and plain brackets only, so no
 * comparison, function, `IS`, `?:` or `BETWEEN` bound can cancel it (GUARD-F1-F3); null if not.
 */
function conjunctReach({ shape, match }: { shape: Shape; match: RegExpExecArray }) {
  let { from, to } = predicateSpan({ masked: shape.masked, match });
  if (to === 0) return null;
  for (let group = shape.groupAt[from] ?? 0; isPlainTerm({ level: shape, from, to, group });) {
    if (group === 0 || shape.subqueries.has(group)) return { from, group };
    const close = shape.closes[group];
    if (close === undefined) return null;
    from = shape.opens[group] ?? 0;
    to = close + 1;
    group = shape.parent[group] ?? 0;
  }
  return null;
}

/** Clause words; a bound predicate scopes rows only under a binding one (GUARD-F2). */
const CLAUSE_WORD =
  /(?<![\w$])(?:SELECT|FROM|JOIN|WHERE|PREWHERE|HAVING|ON|USING|BY|LIMIT|OFFSET|SETTINGS|FORMAT|WINDOW|QUALIFY|WITH|UNION|EXCEPT|INTERSECT|INTO|VALUES|SET|DELETE|UPDATE|TABLE)(?![\w$])/i;
const BINDING_CLAUSES = new Set(["WHERE", "PREWHERE", "HAVING", "ON"]);
const SET_OPERATOR = /(?<![\w$])(?:UNION|EXCEPT|INTERSECT)(?![\w$])/i;
const SOURCE_WORD = /(?<![\w$])(?:FROM|JOIN|TABLE)(?![\w$])/i;
const CTE_NAME = /(?<![\w$])([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/i;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const JOIN_KINDS = new Set(
  "GLOBAL LOCAL ANY ALL ASOF SEMI ANTI INNER LEFT RIGHT FULL OUTER CROSS PASTE ARRAY".split(" "),
);
/** Joins whose `ON` does not drop the joined table's unmatched rows, so cannot bind it. */
const KEEPS_JOINED_ROWS = ["RIGHT", "FULL", "CROSS", "PASTE"];
const NOT_AN_ALIAS = new Set(
  "FINAL SAMPLE PREWHERE WHERE GROUP ORDER LIMIT OFFSET SETTINGS FORMAT HAVING WINDOW QUALIFY UNION"
    .concat(" EXCEPT INTERSECT ON USING JOIN DELETE UPDATE WITH")
    .split(" ")
    .concat([...JOIN_KINDS]),
);
const UNION_ONLY = /^(?:\s|\)|UNION|EXCEPT|INTERSECT|ALL|DISTINCT)*$/i;

type Arm = { group: number; start: number; end: number };
type Source = { at: number; names: string[]; table: boolean; join: boolean; onBinds: boolean };

/** Each scope's arms: the statement and every subquery, split at `UNION`, `EXCEPT`, `INTERSECT`. */
function armsOf(shape: Shape): Arm[] {
  const operators = matchesOf({ pattern: SET_OPERATOR, masked: shape.masked });
  return [...new Set([0, ...shape.subqueries])].flatMap((group) => {
    const start = group === 0 ? 0 : (shape.opens[group] ?? 0) + 1;
    const end = group === 0 ? shape.masked.length : (shape.closes[group] ?? 0);
    const cuts = operators
      .filter((found) => found.index > start && found.index < end)
      .filter((found) => shape.groupAt[found.index] === group)
      .map((found) => found.index);
    return [start, ...cuts].map((from, i) => ({ group, start: from, end: cuts[i] ?? end }));
  });
}

/** A bracket a source may be: a subquery, or brackets holding only a union of them. */
function isDerived({ shape, group }: { shape: Shape; group: number }): boolean {
  if (shape.subqueries.has(group)) return true;
  const open = shape.opens[group] ?? 0;
  let own = "";
  for (let i = open + 1; i < (shape.closes[group] ?? open); i++) {
    own += shape.groupAt[i] === group ? shape.masked.charAt(i) : " ";
  }
  if (!UNION_ONLY.test(own)) return false;
  const children = shape.parent.flatMap((outer, inner) => (outer === group ? [inner] : []));
  return children.every((child) => isDerived({ shape, group: child }));
}

/** The join words before `index` (`LEFT`, `ANY`, `ARRAY`...), nearest first. */
function joinKindsBefore(masked: string, index: number): string[] {
  const kinds: string[] = [];
  let before = tokenBefore(masked, index);
  for (; JOIN_KINDS.has(before.text); before = tokenBefore(masked, before.start)) {
    kinds.push(before.text);
  }
  return kinds;
}

type IsCte = (name: string) => boolean;
type Head = { names: string[]; table: boolean; next: Token };

/** A source's subquery, `{name:Identifier}`, table or table function, and the token after it. */
function sourceHead({
  shape,
  token,
  isCte,
}: {
  shape: Shape;
  token: Token;
  isCte: IsCte;
}): Head | "unparsed" {
  const { masked } = shape;
  if (token.text === "(") {
    const group = shape.groupAt[token.start] ?? 0;
    if (!isDerived({ shape, group })) return "unparsed";
    const next = nextToken(masked, (shape.closes[group] ?? masked.length) + 1);
    return { names: [], table: false, next };
  }
  if (token.text === "{") {
    const close = masked.indexOf("}", token.start);
    return close === -1
      ? "unparsed"
      : { names: [], table: true, next: nextToken(masked, close + 1) };
  }
  let name = token;
  for (let dot = nextToken(masked, name.end); dot.text === "."; dot = nextToken(masked, name.end)) {
    name = nextToken(masked, dot.end);
  }
  const dollar = masked[name.end] === "$";
  if (dollar || !IDENTIFIER.test(name.text)) return "unparsed";
  const after = nextToken(masked, name.end);
  const call = after.text === "(" ? shape.closes[shape.groupAt[after.start] ?? 0] : undefined;
  if (call !== undefined) {
    return { names: [name.text], table: true, next: nextToken(masked, call + 1) };
  }
  return { names: [name.text], table: !isCte(name.text), next: after };
}

/** What the `FROM`, `JOIN` or `ALTER TABLE` at `word` reads; null if it reads nothing. */
function sourceAt({
  shape,
  word,
  isCte,
}: {
  shape: Shape;
  word: RegExpExecArray;
  isCte: IsCte;
}): Source | null | "unparsed" {
  const { masked } = shape;
  const verb = word[0].toUpperCase();
  const previous = tokenBefore(masked, word.index).text;
  const kinds = joinKindsBefore(masked, word.index);
  const readsNothing =
    (verb === "FROM" && previous === "FILL") ||
    (verb === "TABLE" && previous !== "ALTER") ||
    (verb === "JOIN" && kinds.includes("ARRAY"));
  if (readsNothing) return null;
  const start = nextToken(masked, word.index + word[0].length);
  const head = sourceHead({ shape, token: start, isCte });
  if (head === "unparsed") return "unparsed";

  const names = [...head.names];
  let next = head.next.text.toUpperCase() === "AS" ? nextToken(masked, head.next.end) : head.next;
  const alias = next.text.toUpperCase();
  if (IDENTIFIER.test(next.text) && !NOT_AN_ALIAS.has(alias)) {
    names.push(next.text);
    next = nextToken(masked, next.end);
  }
  if (next.text === "," || next.text === "$") return "unparsed";
  const onBinds = !kinds.some((kind) => KEEPS_JOINED_ROWS.includes(kind));
  return { at: word.index, names, table: head.table, join: verb === "JOIN", onBinds };
}

/** The table alias written before a predicate's `TenantId`: null bare, "" when unreadable. */
function qualifierOf({ masked, match }: { masked: string; match: RegExpExecArray }): string | null {
  const tenant = tokenIndex(match);
  if (tokenBefore(masked, tenant).text !== ".") return null;
  return /(?<![\w$])([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*$/.exec(masked.slice(0, tenant))?.[1] ?? "";
}

type ArmAt = (index: number, group: number) => Arm | undefined;

/** Where a CTE is visible: its own arm, or the whole union when it heads the first arm. */
function cteSpan({ arms, arm }: { arms: readonly Arm[]; arm: Arm | undefined }) {
  if (arm === undefined) return { start: 0, end: 0 };
  const siblings = arms.filter((other) => other.group === arm.group);
  const heads = siblings.every((other) => other.start >= arm.start);
  return heads ? { start: arm.start, end: Math.max(...siblings.map((other) => other.end)) } : arm;
}

/** The sources one bound predicate scopes, by its clause, its qualifier and the join it is in. */
function sourcesBoundBy({
  shape,
  match,
  clauses,
  armAt,
  sources,
}: {
  shape: Shape;
  match: RegExpExecArray;
  clauses: readonly RegExpExecArray[];
  armAt: ArmAt;
  sources: ReadonlyMap<Arm, Source[]>;
}): Source[] {
  const reach = conjunctReach({ shape, match });
  const arm = reach === null ? undefined : armAt(reach.from, reach.group);
  if (reach === null || arm === undefined) return [];
  const clause = clauses
    .filter((word) => word.index < reach.from && word.index >= arm.start)
    .filter((word) => shape.groupAt[word.index] === reach.group)
    .at(-1);
  const verb = clause?.[0].toUpperCase() ?? "";
  if (clause === undefined || !BINDING_CLAUSES.has(verb)) return [];
  const qualifier = qualifierOf({ masked: shape.masked, match });
  const own = sources.get(arm) ?? [];
  if (verb !== "ON") {
    if (qualifier === null) return own.slice(0, 1);
    return own.filter((source) => source.names.includes(qualifier));
  }
  const joined = own.filter((source) => source.join && source.at < clause.index).at(-1);
  const named = qualifier !== null && joined?.names.includes(qualifier) === true;
  return joined?.onBinds && named ? [joined] : [];
}

const isSource = (read: Source | null | "unparsed"): read is Source =>
  read !== null && read !== "unparsed";

/**
 * Whether some scope reads a table that none of `binds` scopes: each must be a plain `AND` term
 * in its own arm's WHERE, PREWHERE or HAVING (bare: the arm's first source), or in an inner or
 * left join's ON naming the joined table (GUARD-F2). Text it cannot read fails closed.
 */
function hasUnboundRead({ shape, binds }: { shape: Shape; binds: readonly RegExpExecArray[] }) {
  if (!shape.balanced) return true;
  const { masked, groupAt } = shape;
  const arms = armsOf(shape);
  const armAt: ArmAt = (index, group) =>
    arms.find((arm) => arm.group === group && arm.start <= index && index < arm.end);
  const ctes = matchesOf({ pattern: CTE_NAME, masked })
    .filter((found) => shape.subqueries.has(groupAt[found.index + found[0].length - 1] ?? 0))
    .map((found) => ({
      name: found[1],
      span: cteSpan({ arms, arm: armAt(found.index, groupAt[found.index] ?? 0) }),
    }));
  const isCteAt =
    (index: number): IsCte =>
    (name) =>
      ctes.some((cte) => cte.name === name && cte.span.start <= index && index < cte.span.end);

  const sourceWords = matchesOf({ pattern: SOURCE_WORD, masked });
  const sources = new Map<Arm, Source[]>();
  for (const arm of arms) {
    const words = sourceWords.filter(
      (word) =>
        groupAt[word.index] === arm.group && word.index >= arm.start && word.index < arm.end,
    );
    const read = words.map((word) => sourceAt({ shape, word, isCte: isCteAt(word.index) }));
    if (read.includes("unparsed")) return true;
    sources.set(arm, read.filter(isSource));
  }
  const clauses = matchesOf({ pattern: CLAUSE_WORD, masked });
  const bound = new Set(
    binds.flatMap((match) => sourcesBoundBy({ shape, match, clauses, armAt, sources })),
  );
  return [...sources.values()].flat().some((source) => source.table && !bound.has(source));
}

export function checkTenantScope({
  sql,
  params,
  tenantId,
  tenantIds,
}: {
  sql: string;
  params?: Record<string, unknown> | undefined;
  tenantId: string;
  tenantIds?: readonly string[] | undefined;
}): TenantScopeViolation | null {
  const statement = maskNonCode(sql);
  if (hasNegatedPredicate(statement)) return { kind: "negated-predicate" };
  const shape = shapeOf(statement);
  if (tenantIds !== undefined) return checkTenantSetScope({ shape, params, tenantId, tenantIds });
  const bound = BOUND_TENANT_PREDICATE.exec(statement);

  if (bound === null) {
    return LITERAL_TENANT_PREDICATE.test(statement)
      ? { kind: "literal-predicate" }
      : { kind: "missing-predicate" };
  }

  if (hasWeakeningDisjunction({ masked: statement, predicateIndex: bound.index })) {
    return { kind: "weakening-disjunction" };
  }
  if (conjunctReach({ shape, match: bound }) === null) return { kind: "predicate-not-and-term" };

  const param = bound[1] as string;
  const supplied = params?.[param];

  if (supplied === undefined) return { kind: "missing-param", param };
  if (supplied !== tenantId) {
    return {
      kind: "param-mismatch",
      param,
      expected: tenantId,
      actual: supplied,
    };
  }
  const binds = [
    ...matchesOf({ pattern: BOUND_TENANT_PREDICATE, masked: statement }).filter(
      (match) => params?.[match[1] as string] === tenantId,
    ),
    // A fence the proof expanded to the caller's own project alone binds exactly as `= {t}` does.
    ...matchesOf({ pattern: BOUND_TENANT_SET, masked: statement }).filter((match) => {
      const values = boundBy({ match, params });
      return values.length > 0 && values.every((value) => value === tenantId);
    }),
  ];
  return hasUnboundRead({ shape, binds }) ? { kind: "unbound-read" } : null;
}

/**
 * A declared tenant set: the first `IN` set binds exactly the declared tenants, the claimed tenant
 * among them, and no `OR` disjoins it (one beneath an exact `Array(String)` set does not weaken,
 * M8487-GUARD-ARRAY); other sets bind only declared tenants. The router checks the organisation.
 */
function checkTenantSetScope({
  shape,
  params,
  tenantId,
  tenantIds,
}: {
  shape: Shape;
  params?: Record<string, unknown> | undefined;
  tenantId: string;
  tenantIds: readonly string[];
}): TenantScopeViolation | null {
  const statement = shape.masked;
  const bound = BOUND_TENANT_SET.exec(statement);
  if (bound === null) return { kind: "missing-predicate" };
  const sets = matchesOf({ pattern: BOUND_TENANT_SET, masked: statement });
  const missing = sets.flatMap(placeholdersOf).find((name) => params?.[name] === undefined);
  if (missing !== undefined) return { kind: "missing-param", param: missing };

  const declared = new Set(tenantIds);
  const isDeclared = (value: unknown): boolean => typeof value === "string" && declared.has(value);
  const bindsExactly = (values: readonly unknown[]): boolean =>
    values.every(isDeclared) && new Set(values).size === declared.size;
  const values = boundBy({ match: bound, params });
  if (!declared.has(tenantId) || !bindsExactly(values)) {
    return { kind: "tenant-set-mismatch", declared: tenantIds, bound: values };
  }

  const bindsOnlyDeclared = (match: RegExpExecArray): boolean =>
    boundBy({ match, params }).every(isDeclared);
  const fencingIndexes = sets
    .filter((match) => match[2] !== undefined && bindsExactly(boundBy({ match, params })))
    .map(tokenIndex);
  const weakened = hasWeakeningDisjunction({
    masked: statement,
    predicateIndex: bound.index,
    fencingIndexes,
  });
  if (weakened) return { kind: "weakening-disjunction" };
  if (conjunctReach({ shape, match: bound }) === null) return { kind: "predicate-not-and-term" };

  const outside = sets.find((match) => !bindsOnlyDeclared(match));
  if (outside !== undefined) {
    return {
      kind: "tenant-set-mismatch",
      declared: tenantIds,
      bound: boundBy({ match: outside, params }),
    };
  }
  const binds = [
    ...sets.filter(bindsOnlyDeclared),
    ...matchesOf({ pattern: BOUND_TENANT_PREDICATE, masked: statement }).filter((match) =>
      isDeclared(params?.[match[1] as string]),
    ),
  ];
  return hasUnboundRead({ shape, binds }) ? { kind: "unbound-read" } : null;
}

const placeholdersOf = (match: RegExpExecArray): string[] =>
  match[2] !== undefined
    ? [match[2]]
    : [...(match[1] ?? "").matchAll(PLACEHOLDER_NAME)].map((placeholder) => placeholder[1] ?? "");

/** What a set binds: each String placeholder's value, or an Array(String) parameter's members. */
function boundBy({
  match,
  params,
}: {
  match: RegExpExecArray;
  params?: Record<string, unknown> | undefined;
}): unknown[] {
  if (match[2] === undefined) return placeholdersOf(match).map((name) => params?.[name]);
  const members = params?.[match[2]];
  // Wrapped, a value that is not an array fails every declared-tenant check.
  return Array.isArray(members) ? members : [{ notAnArray: members }];
}

/**
 * The tenant predicate forms the repositories genuinely write. Wider than {@link
 * BOUND_TENANT_PREDICATE} on purpose: that one backs the `QueryRequest` path, where the bound
 * value is also checked against the caller's tenant and so has to name exactly one parameter.
 */
const SCOPED_PREDICATE =
  /(?:^|[\s.(])(?:TenantId|tenant_id|project_id|ProjectId)\s*(?:=|IN)\s*\(?\s*\{\s*[A-Za-z_][A-Za-z0-9_]*\s*:/i;

const LITERAL_PREDICATE =
  /(?:^|[\s.(])(?:TenantId|tenant_id|project_id|ProjectId)\s*=\s*(?:'[^']*'|"[^"]*")/i;

/**
 * Returns the reason a statement names no tenant, or null when it names one. Text only: no
 * parameters, no claimed tenant.
 */
export function checkStatementTenantScope({ sql }: { sql: string }): TenantScopeViolation | null {
  const statement = maskNonCode(sql);
  if (SCOPED_PREDICATE.test(statement)) return null;
  return LITERAL_PREDICATE.test(statement)
    ? { kind: "literal-predicate" }
    : { kind: "missing-predicate" };
}

/** The first table the statement names, for the refusal message. */
export function tableNamedBy(sql: string): string {
  const match =
    /(?:^|[\s(])(?:FROM|INSERT\s+INTO|ALTER\s+TABLE|OPTIMIZE\s+TABLE)\s+([A-Za-z_][A-Za-z0-9_.]*)/i.exec(
      maskNonCode(sql),
    );
  return match?.[1] ?? "unknown";
}

export class TenantScopeError extends Error {
  constructor(
    public readonly violation: TenantScopeViolation,
    public readonly tenantId: string,
  ) {
    super(`${describeTenantScopeViolation(violation)} (tenant "${tenantId}")`);
    this.name = "TenantScopeError";
  }
}

/** The sentence a refusal reads out, shared by both guards. */
export function describeTenantScopeViolation(violation: TenantScopeViolation): string {
  switch (violation.kind) {
    case "missing-predicate":
      return "Statement has no `TenantId = {param:String}` predicate. No other id in this schema is unique across tenants, so this would read another tenant's rows. Add the predicate, or set `SKIP_TENANT_CHECK: true`, with a comment giving the reason, if the statement genuinely spans tenants.";
    case "literal-predicate":
      return "Statement inlines the tenant as a literal instead of binding a parameter. Bind it, so it can be checked against the caller's tenant and cannot be built by concatenation.";
    case "weakening-disjunction":
      return "Statement has an `OR` that can disjoin the tenant predicate away, which would return every tenant's rows. Bracket the disjunction so it cannot weaken the tenant scoping, or set `SKIP_TENANT_CHECK: true`, with a comment giving the reason, if the statement genuinely spans tenants.";
    case "negated-predicate":
      return "Statement negates the tenant predicate with `NOT`, which would return every other tenant's rows. Remove the negation, or set `SKIP_TENANT_CHECK: true`, with a comment giving the reason, if the statement genuinely spans tenants.";
    case "predicate-not-and-term":
      return "Statement's tenant predicate is not a plain `AND` term of its clause (a comparison, a function, `IS`, `?:` or a `BETWEEN` around it), so it could be cancelled and return every other tenant's rows. Keep it a plain `AND` term, or set `SKIP_TENANT_CHECK: true`, with a comment giving the reason, if the statement genuinely spans tenants.";
    case "unbound-read":
      return "Statement reads a table that no tenant predicate of its own scope binds (a `UNION` arm, a subquery, a joined table, or a predicate outside `WHERE`, `PREWHERE`, `HAVING` or an inner or left join's `ON`), which would return other tenants' rows. Bind every read with a plain `AND` term, qualified for a joined table, or set `SKIP_TENANT_CHECK: true`, with a comment giving the reason, if the statement genuinely spans tenants.";
    case "missing-param":
      return `Statement binds tenant parameter "${violation.param}" but no such parameter was supplied.`;
    case "param-mismatch":
      return `Statement binds tenant parameter "${violation.param}" to a different tenant than the request claims.`;
    case "tenant-set-mismatch":
      return "Statement's `TenantId IN (...)` list does not bind exactly the declared tenant set, or the request's tenant is not in it. Bind one placeholder per declared tenant, or one Array(String) parameter holding exactly the set, and nothing else.";
    case "tenant-set-spans-organizations":
      return `The declared tenant set spans ${violation.organizations.length} organisations. A read across tenants stays inside one organisation, which is also the one server that can answer it.`;
    case "missing-row-tenant":
      return `Row ${violation.row} of the batch carries no TenantId. Every written row names the tenant it belongs to, so a later read scoped to one tenant can never miss it or find someone else's.`;
    case "row-tenant-mismatch":
      return `Row ${violation.row} of the batch carries TenantId "${String(violation.actual)}", which is not the tenant the batch is written for. Write one tenant's rows per batch.`;
  }
}

/** The first table a statement names, for the skip counter's label. */
const STATEMENT_TABLE = /\b(?:FROM|INTO|TABLE|UPDATE)\s+`?([\w.]+)`?/i;

/** What a skipped check reports: which kind of call, the table it touched, and its tenant. */
export interface SkippedTenantCheck {
  operation: "statement" | "insert";
  table: string;
  tenantId: string;
}

export interface TenantGuardOptions {
  /** Called for each statement or batch that set `SKIP_TENANT_CHECK`, so they can be counted. */
  onUnscoped?: ((skipped: SkippedTenantCheck) => void) | undefined;
}

/**
 * Refuses a statement that cannot name its tenant. Placed outermost by {@link
 * ClickHouseQueryClient}: refusing costs nothing, and it should happen before a rate-limit slot
 * or a retry budget is spent on a statement that must not run.
 */
export class TenantGuard {
  private readonly onUnscoped: ((skipped: SkippedTenantCheck) => void) | undefined;

  constructor({ onUnscoped }: TenantGuardOptions = {}) {
    this.onUnscoped = onUnscoped;
  }

  /**
   * Throws {@link TenantScopeError} unless the statement is tenant-scoped or sets
   * `SKIP_TENANT_CHECK`. Returns nothing on success rather than the request: it is a check,
   * and a caller that had to remember to use a returned value could forget to.
   */
  assert(request: QueryRequest): void {
    if (request.SKIP_TENANT_CHECK === true) {
      // `quietly`: a throwing counter must not refuse what the guard allowed (./resilience.ts).
      quietly(() =>
        this.onUnscoped?.({
          operation: "statement",
          table: request.table ?? STATEMENT_TABLE.exec(request.sql)?.[1] ?? "unknown",
          tenantId: request.tenantId,
        }),
      );
      return;
    }

    const violation = checkTenantScope({
      sql: request.sql,
      params: request.params,
      tenantId: request.tenantId,
      tenantIds: request.tenantIds,
    });
    if (violation !== null) {
      throw new TenantScopeError(violation, request.tenantId);
    }
  }

  /**
   * Throws {@link TenantScopeError} unless every row names the tenant the
   * batch is written for — the batch is its own evidence, since a write has
   * no predicate. Every row is checked, not just the first, to catch a mixed batch.
   */
  assertInsert(request: InsertRequest): void {
    if (request.SKIP_TENANT_CHECK === true) {
      quietly(() =>
        this.onUnscoped?.({
          operation: "insert",
          table: request.table,
          tenantId: request.tenantId,
        }),
      );
      return;
    }
    const violation = checkInsertTenantScope(request);
    if (violation !== null) {
      throw new TenantScopeError(violation, request.tenantId);
    }
  }
}

/** Returns the reason a batch is not one tenant's, or null when it is. */
export function checkInsertTenantScope(
  request: Pick<InsertRequest, "tenantId" | "rows">,
): TenantScopeViolation | null {
  for (const [index, row] of request.rows.entries()) {
    const tenantId = row.TenantId;
    if (tenantId === undefined || tenantId === null || tenantId === "") {
      return { kind: "missing-row-tenant", row: index };
    }
    if (tenantId !== request.tenantId) {
      return { kind: "row-tenant-mismatch", row: index, actual: tenantId };
    }
  }
  return null;
}
