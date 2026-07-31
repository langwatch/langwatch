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
  MAX_PREDICATE_DEPTH,
  type LwqlComparisonOperator,
  type LwqlLiteral,
  type LwqlOrderBy,
  type LwqlPredicate,
  type LwqlQuery,
  type LwqlSelectItem,
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

const tokenize = (input: string): Token[] => {
  if (input.length > MAX_QUERY_LENGTH) {
    throw new LwqlError("parse_error", "Query is too long.", {
      hint: `Queries are limited to ${MAX_QUERY_LENGTH} characters.`,
    });
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Line comments keep saved/generated queries annotatable.
    if (ch === "-" && input[i + 1] === "-") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      i++;
      let value = "";
      let closed = false;
      while (i < input.length) {
        if (input[i] === "\\" && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        // SQL's own escape: a doubled quote is one literal quote. Without this,
        // `'o''brien'` terminates early and the remainder parses as garbage.
        if (input[i] === quote && input[i + 1] === quote) {
          value += quote;
          i += 2;
          continue;
        }
        if (input[i] === quote) {
          closed = true;
          i++;
          break;
        }
        value += input[i];
        i++;
      }
      if (!closed) {
        throw new LwqlError("parse_error", "Unterminated string literal.", {
          hint: "Add the closing quote.",
          position: start,
        });
      }
      tokens.push({ type: "string", value, position: start });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      while (i < input.length && /[0-9._]/.test(input[i]!)) i++;
      // `24h` — a duration shorthand; the unit rides along on the token.
      while (i < input.length && /[a-zA-Z]/.test(input[i]!)) i++;
      tokens.push({
        type: "number",
        value: input.slice(start, i),
        position: start,
      });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i]!)) i++;
      tokens.push({
        type: "identifier",
        value: input.slice(start, i),
        position: start,
      });
      continue;
    }

    const twoChar = input.slice(i, i + 2);
    if (MULTI_CHAR_OPERATORS.includes(twoChar)) {
      tokens.push({ type: "operator", value: twoChar, position: i });
      i += 2;
      continue;
    }

    if (SINGLE_CHAR_OPERATORS.includes(ch)) {
      tokens.push({ type: "operator", value: ch, position: i });
      i++;
      continue;
    }

    if ("(),*".includes(ch)) {
      tokens.push({ type: "punctuation", value: ch, position: i });
      i++;
      continue;
    }

    throw new LwqlError("parse_error", `Unexpected character '${ch}'.`, {
      hint: "Remove it — LWQL supports a small SQL subset.",
      position: i,
    });
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
      token.type === "identifier" &&
      words.includes(token.value.toLowerCase())
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

    let where: LwqlPredicate | undefined;
    if (this.atKeyword("where")) {
      this.next();
      where = this.parseOr(0);
    }

    let groupBy: string[] | undefined;
    if (this.atKeyword("group")) {
      this.next();
      this.expectKeyword("by");
      groupBy = this.parseNameList();
    }

    let orderBy: LwqlOrderBy[] | undefined;
    if (this.atKeyword("order")) {
      this.next();
      this.expectKeyword("by");
      orderBy = this.parseOrderList();
    }

    let limit: number | undefined;
    if (this.atKeyword("limit")) {
      this.next();
      limit = this.parseInteger("LIMIT");
    }

    let offset: number | undefined;
    if (this.atKeyword("offset")) {
      this.next();
      offset = this.parseInteger("OFFSET");
    }

    const trailing = this.peek();
    if (trailing.type !== "eof") {
      throw new LwqlError(
        "parse_error",
        `Unexpected '${trailing.value}' after the end of the query.`,
        {
          hint: "LWQL supports SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT and OFFSET only — joins and subqueries are not available.",
          position: trailing.position,
        },
      );
    }

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
      throw new LwqlError("parse_error", "SELECT requires at least one column.");
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

  private parseOrderList(): LwqlOrderBy[] {
    const items: LwqlOrderBy[] = [];
    do {
      const name = this.expectName("a field name");
      let field = name;
      let fn: string | undefined;

      const after = this.peek();
      if (after.type === "punctuation" && after.value === "(") {
        this.next();
        const inner = this.peek();
        if (inner.type === "punctuation" && inner.value === "*") {
          this.next();
          field = "*";
        } else {
          field = this.expectName("a field name");
        }
        this.expectPunctuation(")");
        fn = name;
      }

      let direction: "asc" | "desc" = "asc";
      if (this.atKeyword("asc", "desc")) {
        direction = this.next().value.toLowerCase() as "asc" | "desc";
      }

      items.push({ field, direction, ...(fn ? { fn } : {}) });
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

  private parseComparison(): LwqlPredicate {
    const fieldToken = this.peek();
    const field = this.expectName("a field name");

    // IS NULL / IS NOT NULL
    if (this.atKeyword("is")) {
      this.next();
      let op: LwqlComparisonOperator = "is_null";
      if (this.atKeyword("not")) {
        this.next();
        op = "is_not_null";
      }
      this.expectKeyword("null");
      return { field, op };
    }

    // [NOT] IN (…) / [NOT] LIKE '…'
    let negated = false;
    if (this.atKeyword("not")) {
      this.next();
      negated = true;
    }

    if (this.atKeyword("in")) {
      this.next();
      this.expectPunctuation("(");
      const values: LwqlLiteral[] = [];
      do {
        values.push(this.parseLiteral());
      } while (this.consumeComma());
      this.expectPunctuation(")");
      return { field, op: negated ? "not_in" : "in", value: values };
    }

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

    return {
      field,
      op: op as LwqlComparisonOperator,
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
      const word = token.value.toLowerCase();
      if (word === "true" || word === "false") {
        this.next();
        return word === "true";
      }
      if (word === "null") {
        this.next();
        return null;
      }
      if (word === "now") {
        return this.parseNowExpression();
      }
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
    const sign = operator.value === "-" ? -1 : 1;

    if (this.atKeyword("interval")) {
      this.next();
    }

    const amountToken = this.next();
    if (amountToken.type !== "number") {
      throw new LwqlError(
        "parse_error",
        `Expected a duration after now() ${operator.value}.`,
        {
          hint: "Write now() - INTERVAL 24 HOUR, or the shorthand now() - INTERVAL 24h.",
          position: amountToken.position,
        },
      );
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
    let unit = match[2]!.toLowerCase();

    if (!unit) {
      const unitToken = this.next();
      if (unitToken.type !== "identifier") {
        throw new LwqlError(
          "parse_error",
          "Expected a duration unit such as HOUR or DAY.",
          { position: unitToken.position },
        );
      }
      unit = unitToken.value.toLowerCase();
    }

    const multiplier = DURATION_UNITS[unit];
    if (multiplier === undefined || !Number.isFinite(amount)) {
      throw new LwqlError("parse_error", `Unknown duration unit '${unit}'.`, {
        hint: `Supported units: ${[...new Set(Object.keys(DURATION_UNITS))].join(", ")}.`,
        position: amountToken.position,
      });
    }

    return this.now + sign * amount * multiplier;
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
