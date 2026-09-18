/**
 * LWQL text parser — SQL-like syntax to IR.
 *
 * Issue #6346 decision 1: this is a *front-end*, not a security boundary. It can
 * only emit `LwqlQuery` (see `ir.ts`), and the compiler validates every
 * identifier against the catalogue regardless of how the IR was produced. A
 * caller posting IR directly is exactly as constrained as one posting text.
 *
 * ADR-081 decision 9: the grammar is `node-sql-parser`'s, not ours. A
 * hand-rolled tokenizer and recursive-descent parser rejected fifteen ordinary
 * SQL constructs and mis-lexed five of them outright (`-1`, `1e5`, `.5`, a
 * trailing `;`, an alias without `AS`); a maintained parser gets those right by
 * construction. What stays ours is the *narrowing*: `ast-to-ir` walks the AST
 * with a default-deny switch on every node kind, so the language LWQL accepts
 * is decided here, not by whatever the upstream grammar happens to parse.
 *
 *     SELECT model, avg(cost_usd) AS c, count(*)
 *     FROM traces
 *     WHERE has_error = true AND started_at >= now() - INTERVAL 24 HOUR
 *     GROUP BY model
 *     ORDER BY c DESC
 *     LIMIT 100
 */

import sqlParser from "node-sql-parser/build/postgresql.js";

import { astToIr } from "./ast-to-ir";
import { LwqlError } from "./errors";
import type { LwqlQuery } from "./ir";

/**
 * PostgreSQL's grammar, and only PostgreSQL's.
 *
 * The dialect is a *lexing* choice — nothing downstream of the walker is
 * Postgres-shaped, and the compiler emits ClickHouse from the IR. It was picked
 * by probe: of the five dialects tried, Postgres was the only one that read
 * every construct LWQL's own tests use, including leading-dot decimals (`.5`)
 * and MySQL-style `INTERVAL 24 HOUR`.
 *
 * The dialect-specific build is deliberate too. It carries one grammar rather
 * than fourteen, and refuses `{ database: "mysql" }` outright, so a stray option
 * cannot quietly swap the language a caller is writing in.
 */
const DIALECT = { database: "postgresql" } as const;

const parser = new sqlParser.Parser();

const MAX_QUERY_LENGTH = 8000;

/** Characters of the offending text quoted back in a syntax error. */
const SNIPPET_LENGTH = 24;

const GRAMMAR_HINT =
  "Queries read SELECT … FROM … [WHERE …] [GROUP BY …] [ORDER BY …] [LIMIT n] [OFFSET n].";

/** A `pegjs` syntax error, once it is clear that is what was thrown. */
interface SyntaxErrorLocation {
  location?: { start?: { offset?: number } };
}

const offsetOf = (error: unknown): number | undefined => {
  const location = (error as SyntaxErrorLocation | null)?.location?.start
    ?.offset;
  return typeof location === "number" ? location : undefined;
};

/**
 * A duration written the way the old hand-rolled tokenizer accepted it.
 *
 * `24h` lexed as a single token there and is a syntax error in real SQL: the
 * grammar reads `24`, then fails on the letter glued to it. That is exactly the
 * signature matched here, so an author who learned the old shorthand gets told
 * the new spelling instead of a generic "could not parse".
 */
const looksLikeBareDuration = (text: string, offset: number): boolean =>
  /\d$/.test(text.slice(0, offset)) && /^[a-z]/i.test(text.slice(offset));

const hintFor = (text: string, offset: number | undefined): string =>
  offset !== undefined && looksLikeBareDuration(text, offset)
    ? "Durations are written INTERVAL 24 HOUR, or INTERVAL '24h'."
    : GRAMMAR_HINT;

/**
 * Translates a parser syntax error into LWQL's own.
 *
 * The underlying message lists every token the grammar could have accepted —
 * hundreds of them — which is worse than useless in an API response. What is
 * worth keeping is *where* it failed, so the caller's editor can point at it.
 */
const syntaxError = (error: unknown, text: string): LwqlError => {
  const offset = offsetOf(error);
  const snippet =
    offset === undefined ? "" : text.slice(offset, offset + SNIPPET_LENGTH);

  return new LwqlError(
    "parse_error",
    snippet
      ? `Could not parse the query at '${snippet}'.`
      : "Could not parse the query — it ends before it is complete.",
    {
      hint: hintFor(text, offset),
      ...(offset === undefined ? {} : { position: offset }),
    },
  );
};

/**
 * Parses SQL-like text into IR.
 *
 * Names are resolved against the catalogue as they are walked, so an unknown
 * field or entity is reported here with the same message the compiler would
 * give — the text surface never produces IR carrying a name the language does
 * not have.
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
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new LwqlError("parse_error", "Query is too long.", {
      hint: `Queries are limited to ${MAX_QUERY_LENGTH} characters.`,
    });
  }

  let ast: unknown;
  try {
    ast = parser.astify(trimmed, DIALECT);
  } catch (error) {
    // Only a parse failure is translated; an LwqlError from the walker would
    // never reach here, and anything else is a bug worth surfacing as one.
    throw syntaxError(error, trimmed);
  }

  return astToIr(ast, options.now ?? Date.now());
};
