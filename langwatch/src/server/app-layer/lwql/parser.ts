/**
 * LWQL text parser — SQL-like syntax to IR.
 *
 * Issue #6346 decision 1: this is a *front-end*, not a security boundary. It can
 * only emit `LwqlQuery` (see `ir.ts`), and the compiler validates every
 * identifier against the catalogue regardless of how the IR was produced. A
 * caller posting IR directly is exactly as constrained as one posting text.
 *
 * The grammar is deliberately small — no joins, no subqueries, no `UNION`, no
 * expressions in SELECT beyond a single allowlisted aggregate. "Looks like SQL"
 * is a syntax decision; it is not a promise of SQL semantics.
 *
 *     SELECT model, avg(cost_usd) AS c, count(*)
 *     FROM traces
 *     WHERE has_error = true AND started_at >= now() - INTERVAL 24 HOUR
 *     GROUP BY model
 *     ORDER BY c DESC
 *     LIMIT 100
 */

import { LwqlError } from "./errors";
import {
  type LwqlComparisonOperator,
  type LwqlLiteral,
  type LwqlOrderBy,
  type LwqlPredicate,
  type LwqlQuery,
  type LwqlSelectItem,
  MAX_PREDICATE_DEPTH,
} from "./ir";

type TokenType =
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "punctuation"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

const KEYWORDS = new Set([
  "select",
  "from",
  "where",
  "group",
  "order",
  "by",
  "limit",
  "offset",
  "and",
  "or",
  "not",
  "in",
  "like",
  "is",
  "null",
  "as",
  "asc",
  "desc",
  "true",
  "false",
  "interval",
]);

const MULTI_CHAR_OPERATORS = [">=", "<=", "!=", "<>"];
const SINGLE_CHAR_OPERATORS = ["=", ">", "<", "-", "+"];

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
  w: 604_800_000,
  week: 604_800_000,
  weeks: 604_800_000,
};

const MAX_QUERY_LENGTH = 8000;

/** A scanner's result: the token it produced, and where scanning resumes. */
interface Scanned {
  token: Token;
  next: number;
}

/** Skips whitespace and `-- line comments`, returning the next code position. */
const skipTrivia = (input: string, start: number): number => {
  let i = start;
  while (i < input.length) {
    if (/\s/.test(input[i]!)) {
      i++;
      continue;
    }
    if (input[i] === "-" && input[i + 1] === "-") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }
    break;
  }
  return i;
};

/**
 * Scans a quoted string. Two escapes are honoured: a backslash pair, and SQL's
 * own doubled quote — without the latter, `'o''brien'` terminates early and the
 * remainder parses as garbage.
 */
const scanString = (input: string, start: number): Scanned => {
  const quote = input[start]!;
  let i = start + 1;
  let value = "";

  while (i < input.length) {
    if (input[i] === "\\" && i + 1 < input.length) {
      value += input[i + 1];
      i += 2;
      continue;
    }
    if (input[i] === quote && input[i + 1] === quote) {
      value += quote;
      i += 2;
      continue;
    }
    if (input[i] === quote) {
      return { token: { type: "string", value, position: start }, next: i + 1 };
    }
    value += input[i];
    i++;
  }

  throw new LwqlError("parse_error", "Unterminated string literal.", {
    hint: "Add the closing quote.",
    position: start,
  });
};

/** Scans a number, keeping any trailing unit so `24h` stays one token. */
const scanNumber = (input: string, start: number): Scanned => {
  let i = start;
  while (i < input.length && /[0-9._]/.test(input[i]!)) i++;
  while (i < input.length && /[a-zA-Z]/.test(input[i]!)) i++;
  return {
    token: { type: "number", value: input.slice(start, i), position: start },
    next: i,
  };
};

const scanIdentifier = (input: string, start: number): Scanned => {
  let i = start;
  while (i < input.length && /[a-zA-Z0-9_]/.test(input[i]!)) i++;
  return {
    token: {
      type: "identifier",
      value: input.slice(start, i),
      position: start,
    },
    next: i,
  };
};

/** Scans an operator or punctuation mark, or returns null if `ch` is neither. */
const scanSymbol = (input: string, start: number): Scanned | null => {
  const twoChar = input.slice(start, start + 2);
  if (MULTI_CHAR_OPERATORS.includes(twoChar)) {
    return {
      token: { type: "operator", value: twoChar, position: start },
      next: start + 2,
    };
  }

  const ch = input[start]!;
  if (SINGLE_CHAR_OPERATORS.includes(ch)) {
    return {
      token: { type: "operator", value: ch, position: start },
      next: start + 1,
    };
  }
  if ("(),*".includes(ch)) {
    return {
      token: { type: "punctuation", value: ch, position: start },
      next: start + 1,
    };
  }
  return null;
};

/** Dispatches one token by its opening character. */
const scanToken = (input: string, start: number): Scanned => {
  const ch = input[start]!;

  if (ch === "'" || ch === '"') return scanString(input, start);
  if (/[0-9]/.test(ch)) return scanNumber(input, start);
  if (/[a-zA-Z_]/.test(ch)) return scanIdentifier(input, start);

  const symbol = scanSymbol(input, start);
  if (symbol) return symbol;

  throw new LwqlError("parse_error", `Unexpected character '${ch}'.`, {
    hint: "Remove it — LWQL supports a small SQL subset.",
    position: start,
  });
};

const tokenize = (input: string): Token[] => {
  if (input.length > MAX_QUERY_LENGTH) {
    throw new LwqlError("parse_error", "Query is too long.", {
      hint: `Queries are limited to ${MAX_QUERY_LENGTH} characters.`,
    });
  }

  const tokens: Token[] = [];
  let i = skipTrivia(input, 0);

  while (i < input.length) {
    const { token, next } = scanToken(input, i);
    tokens.push(token);
    i = skipTrivia(input, next);
  }

  tokens.push({ type: "eof", value: "", position: input.length });
  return tokens;
};

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly now: number,
  ) {}

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private next(): Token {
    return this.tokens[this.index++]!;
  }

  private atKeyword(...words: string[]): boolean {
    const token = this.peek();
    return (
      token.type === "identifier" && words.includes(token.value.toLowerCase())
    );
  }

  private expectKeyword(word: string): void {
    const token = this.next();
    if (token.type !== "identifier" || token.value.toLowerCase() !== word) {
      throw new LwqlError(
        "parse_error",
        `Expected ${word.toUpperCase()} but found '${token.value || "end of query"}'.`,
        {
          hint: `Queries read SELECT … FROM … [WHERE …] [GROUP BY …] [ORDER BY …] [LIMIT n].`,
          position: token.position,
        },
      );
    }
  }

  private expectPunctuation(char: string): void {
    const token = this.next();
    if (token.type !== "punctuation" || token.value !== char) {
      throw new LwqlError(
        "parse_error",
        `Expected '${char}' but found '${token.value || "end of query"}'.`,
        { position: token.position },
      );
    }
  }

  /** Reads a non-keyword identifier — a field name, entity name, or alias. */
  private expectName(what: string): string {
    const token = this.next();
    if (token.type !== "identifier") {
      throw new LwqlError(
        "parse_error",
        `Expected ${what} but found '${token.value || "end of query"}'.`,
        { position: token.position },
      );
    }
    return token.value.toLowerCase();
  }

  parse(): LwqlQuery {
    this.expectKeyword("select");
    const select = this.parseSelectList();

    this.expectKeyword("from");
    const from = this.expectName("an entity name");

    const where = this.parseOptionalClause("where", () => this.parseOr(0));
    const groupBy = this.parseOptionalByClause("group", () =>
      this.parseNameList(),
    );
    const orderBy = this.parseOptionalByClause("order", () =>
      this.parseOrderList(),
    );
    const limit = this.parseOptionalClause("limit", () =>
      this.parseInteger("LIMIT"),
    );
    const offset = this.parseOptionalClause("offset", () =>
      this.parseInteger("OFFSET"),
    );

    this.expectEnd();

    return {
      from,
      select,
      ...(where ? { where } : {}),
      ...(groupBy ? { group_by: groupBy } : {}),
      ...(orderBy ? { order_by: orderBy } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    };
  }

  /** Parses `<keyword> <body>` when the keyword is present, else undefined. */
  private parseOptionalClause<T>(
    keyword: string,
    body: () => T,
  ): T | undefined {
    if (!this.atKeyword(keyword)) return undefined;
    this.next();
    return body();
  }

  /** As `parseOptionalClause`, for the two-word `GROUP BY` / `ORDER BY` forms. */
  private parseOptionalByClause<T>(
    keyword: string,
    body: () => T,
  ): T | undefined {
    return this.parseOptionalClause(keyword, () => {
      this.expectKeyword("by");
      return body();
    });
  }

  /**
   * Rejects anything after the final clause. Without this a query ending in
   * unsupported SQL (a JOIN, a subquery) would silently parse as its valid
   * prefix and run something the caller did not ask for.
   */
  private expectEnd(): void {
    const trailing = this.peek();
    if (trailing.type === "eof") return;

    throw new LwqlError(
      "parse_error",
      `Unexpected '${trailing.value}' after the end of the query.`,
      {
        hint: "LWQL supports SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT and OFFSET only — joins and subqueries are not available.",
        position: trailing.position,
      },
    );
  }

  private parseInteger(clause: string): number {
    const token = this.next();
    const parsed = Number(token.value);
    if (token.type !== "number" || !Number.isInteger(parsed) || parsed < 0) {
      throw new LwqlError(
        "parse_error",
        `${clause} expects a whole number, found '${token.value}'.`,
        { position: token.position },
      );
    }
    return parsed;
  }

  private parseSelectList(): LwqlSelectItem[] {
    const items: LwqlSelectItem[] = [];
    do {
      items.push(this.parseSelectItem());
    } while (this.consumeComma());

    if (items.length === 0) {
      throw new LwqlError(
        "parse_error",
        "SELECT requires at least one column.",
      );
    }
    return items;
  }

  private consumeComma(): boolean {
    const token = this.peek();
    if (token.type === "punctuation" && token.value === ",") {
      this.next();
      return true;
    }
    return false;
  }

  private parseSelectItem(): LwqlSelectItem {
    const token = this.peek();

    if (token.type === "punctuation" && token.value === "*") {
      throw new LwqlError("parse_error", "SELECT * is not supported.", {
        hint: "List the columns you want, e.g. SELECT trace_id, duration_ms.",
        position: token.position,
      });
    }

    const rawName = this.peek().value;
    const name = this.expectName("a column or function");

    let item: LwqlSelectItem;
    const after = this.peek();
    if (after.type === "punctuation" && after.value === "(") {
      this.next();
      let field: string;
      const inner = this.peek();
      if (inner.type === "punctuation" && inner.value === "*") {
        this.next();
        field = "*";
      } else {
        field = this.expectName("a field name");
      }
      this.expectPunctuation(")");
      // Function names match case-insensitively, as in SQL, but the original
      // spelling is carried so an "unknown function" error echoes what the
      // author actually typed.
      item = { field, fn: name, fnRaw: rawName };
    } else {
      item = { field: name };
    }

    if (this.atKeyword("as")) {
      this.next();
      item.as = this.expectName("an alias");
    }

    return item;
  }

  private parseNameList(): string[] {
    const names: string[] = [];
    do {
      names.push(this.expectName("a field name"));
    } while (this.consumeComma());
    return names;
  }

  /**
   * Consumes `( field )` or `( * )` when the next token opens a call, so
   * `count(*)` and a bare `model` are told apart by one lookahead. Returns null
   * when there is no call to consume.
   */
  private tryParseCallArgument(): string | null {
    const after = this.peek();
    if (after.type !== "punctuation" || after.value !== "(") return null;

    this.next();
    const inner = this.peek();
    const field =
      inner.type === "punctuation" && inner.value === "*"
        ? (this.next(), "*")
        : this.expectName("a field name");
    this.expectPunctuation(")");
    return field;
  }

  private parseOrderItem(): LwqlOrderBy {
    const name = this.expectName("a field name");
    const called = this.tryParseCallArgument();

    const direction = this.atKeyword("asc", "desc")
      ? (this.next().value.toLowerCase() as "asc" | "desc")
      : "asc";

    return called === null
      ? { field: name, direction }
      : { field: called, direction, fn: name };
  }

  private parseOrderList(): LwqlOrderBy[] {
    const items: LwqlOrderBy[] = [];
    do {
      items.push(this.parseOrderItem());
    } while (this.consumeComma());
    return items;
  }

  private parseOr(depth: number): LwqlPredicate {
    this.guardDepth(depth);
    const terms = [this.parseAnd(depth + 1)];
    while (this.atKeyword("or")) {
      this.next();
      terms.push(this.parseAnd(depth + 1));
    }
    return terms.length === 1 ? terms[0]! : { or: terms };
  }

  private parseAnd(depth: number): LwqlPredicate {
    this.guardDepth(depth);
    const terms = [this.parseUnary(depth + 1)];
    while (this.atKeyword("and")) {
      this.next();
      terms.push(this.parseUnary(depth + 1));
    }
    return terms.length === 1 ? terms[0]! : { and: terms };
  }

  private parseUnary(depth: number): LwqlPredicate {
    this.guardDepth(depth);
    if (this.atKeyword("not")) {
      this.next();
      return { not: this.parseUnary(depth + 1) };
    }

    const token = this.peek();
    if (token.type === "punctuation" && token.value === "(") {
      this.next();
      const inner = this.parseOr(depth + 1);
      this.expectPunctuation(")");
      return inner;
    }

    return this.parseComparison();
  }

  private guardDepth(depth: number): void {
    if (depth > MAX_PREDICATE_DEPTH) {
      throw new LwqlError("parse_error", "WHERE clause is nested too deeply.", {
        hint: `Flatten it to at most ${MAX_PREDICATE_DEPTH} levels.`,
      });
    }
  }

  /** `IS NULL` / `IS NOT NULL`, once `IS` has been seen. */
  private parseIsNull(field: string): LwqlPredicate {
    this.next();
    let op: LwqlComparisonOperator = "is_null";
    if (this.atKeyword("not")) {
      this.next();
      op = "is_not_null";
    }
    this.expectKeyword("null");
    return { field, op };
  }

  /** `IN ( … )`, once `IN` has been seen. */
  private parseIn(field: string, negated: boolean): LwqlPredicate {
    this.next();
    this.expectPunctuation("(");
    const values: LwqlLiteral[] = [];
    do {
      values.push(this.parseLiteral());
    } while (this.consumeComma());
    this.expectPunctuation(")");
    return { field, op: negated ? "not_in" : "in", value: values };
  }

  /** Reads and validates a binary comparison operator. */
  private expectComparisonOperator(field: string): LwqlComparisonOperator {
    const opToken = this.next();
    if (opToken.type !== "operator") {
      throw new LwqlError(
        "parse_error",
        `Expected a comparison operator after '${field}' but found '${opToken.value || "end of query"}'.`,
        {
          hint: "Use =, !=, >, >=, <, <=, IN, LIKE or IS NULL.",
          position: opToken.position,
        },
      );
    }

    const op = opToken.value === "<>" ? "!=" : opToken.value;
    if (!["=", "!=", ">", ">=", "<", "<="].includes(op)) {
      throw new LwqlError(
        "parse_error",
        `Operator '${opToken.value}' is not valid in a comparison.`,
        { position: opToken.position },
      );
    }
    return op as LwqlComparisonOperator;
  }

  private parseComparison(): LwqlPredicate {
    const fieldToken = this.peek();
    const field = this.expectName("a field name");

    if (this.atKeyword("is")) return this.parseIsNull(field);

    // `NOT` here belongs to the following IN/LIKE, not to the whole clause —
    // clause-level negation is handled by parseUnary.
    const negated = this.atKeyword("not");
    if (negated) this.next();

    if (this.atKeyword("in")) return this.parseIn(field, negated);

    if (this.atKeyword("like")) {
      this.next();
      return {
        field,
        op: negated ? "not_like" : "like",
        value: this.parseLiteral(),
      };
    }

    if (negated) {
      throw new LwqlError(
        "parse_error",
        `Expected IN or LIKE after NOT on '${field}'.`,
        { position: fieldToken.position },
      );
    }

    return {
      field,
      op: this.expectComparisonOperator(field),
      value: this.parseLiteral(),
    };
  }

  private parseLiteral(): LwqlLiteral {
    const token = this.peek();

    if (token.type === "string") {
      this.next();
      return token.value;
    }

    if (token.type === "number") {
      this.next();
      const parsed = Number(token.value.replace(/_/g, ""));
      if (Number.isNaN(parsed)) {
        throw new LwqlError(
          "parse_error",
          `'${token.value}' is not a valid number.`,
          { position: token.position },
        );
      }
      return parsed;
    }

    if (token.type === "identifier") {
      const keyword = this.tryParseKeywordLiteral(token.value.toLowerCase());
      if (keyword !== undefined) return keyword;
    }

    throw new LwqlError(
      "parse_error",
      `Expected a value but found '${token.value || "end of query"}'.`,
      {
        hint: "Values are quoted strings, numbers, true/false, null, or now() arithmetic.",
        position: token.position,
      },
    );
  }

  /** `true` / `false` / `null` / `now(...)`, or undefined if not one of them. */
  private tryParseKeywordLiteral(word: string): LwqlLiteral | undefined {
    if (word === "true" || word === "false") {
      this.next();
      return word === "true";
    }
    if (word === "null") {
      this.next();
      return null;
    }
    if (word === "now") return this.parseNowExpression();
    return undefined;
  }

  /**
   * Reads the duration after `now() -`, in either the `24 HOUR` or `24h` form,
   * and returns it in milliseconds.
   */
  private parseDurationMs(): number {
    const amountToken = this.next();
    if (amountToken.type !== "number") {
      throw new LwqlError("parse_error", "Expected a duration after now().", {
        hint: "Write now() - INTERVAL 24 HOUR, or the shorthand now() - INTERVAL 24h.",
        position: amountToken.position,
      });
    }

    // The tokenizer keeps `24h` as one token; split the trailing unit back off.
    const match = /^([0-9._]+)([a-zA-Z]*)$/.exec(amountToken.value);
    if (!match) {
      throw new LwqlError(
        "parse_error",
        `'${amountToken.value}' is not a valid duration.`,
        { position: amountToken.position },
      );
    }

    const amount = Number(match[1]!.replace(/_/g, ""));
    const unit = match[2] ? match[2].toLowerCase() : this.expectDurationUnit();

    const multiplier = DURATION_UNITS[unit];
    if (multiplier === undefined || !Number.isFinite(amount)) {
      throw new LwqlError("parse_error", `Unknown duration unit '${unit}'.`, {
        hint: `Supported units: ${[...new Set(Object.keys(DURATION_UNITS))].join(", ")}.`,
        position: amountToken.position,
      });
    }

    return amount * multiplier;
  }

  private expectDurationUnit(): string {
    const unitToken = this.next();
    if (unitToken.type !== "identifier") {
      throw new LwqlError(
        "parse_error",
        "Expected a duration unit such as HOUR or DAY.",
        { position: unitToken.position },
      );
    }
    return unitToken.value.toLowerCase();
  }

  /**
   * `now()`, `now() - INTERVAL 24 HOUR`, and the shorthand `now() - INTERVAL 24h`.
   *
   * Resolved to epoch milliseconds at parse time, so the IR carries an absolute
   * instant. Two callers running the same saved text a day apart get windows
   * anchored to their own "now", and a stored IR always means what it said.
   */
  private parseNowExpression(): number {
    this.next(); // `now`
    this.expectPunctuation("(");
    this.expectPunctuation(")");

    const operator = this.peek();
    if (operator.type !== "operator" || !["-", "+"].includes(operator.value)) {
      return this.now;
    }
    this.next();

    if (this.atKeyword("interval")) this.next();

    const sign = operator.value === "-" ? -1 : 1;
    return this.now + sign * this.parseDurationMs();
  }
}

/**
 * Parses SQL-like text into IR. Does not validate names against the catalogue —
 * that is the compiler's job, and it happens for structured input too.
 */
export const parseLwql = (
  text: string,
  options: { now?: number } = {},
): LwqlQuery => {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new LwqlError("parse_error", "Query is empty.", {
      hint: "Start with SELECT, e.g. SELECT count(*) FROM traces.",
    });
  }
  return new Parser(tokenize(trimmed), options.now ?? Date.now()).parse();
};

/** Exported for tests that need to assert tokenisation directly. */
export const __tokenize = tokenize;
export const __KEYWORDS = KEYWORDS;
