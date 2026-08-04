/**
 * Governed analytics SQL — the parser seam.
 *
 * The validator walks a tree of `{ type, ...fields }` nodes and knows nothing
 * about how that tree was produced. This module is the only place that knows,
 * which is what makes the parser replaceable: swapping `@clickhouse/parser` for
 * another front end means writing another {@link GovernedSqlParser} that emits
 * the same node vocabulary, and changing nothing in the walker.
 *
 * Two properties are load-bearing and belong here rather than at the call site:
 *
 *  - **Nothing escapes.** A parser is a large piece of generated code fed
 *    attacker-controlled text; it can throw anything, including a `RangeError`
 *    from its own recursion. Every throw becomes `{ ok: false }`, so a parser
 *    that breaks refuses the query instead of letting it past unvalidated.
 *  - **The failure reason is not the parser's message.** A parse diagnostic
 *    quotes the input and names grammar internals; the caller gets a fixed
 *    sentence and the position, and the detail stays in the log.
 *
 * @see specs/analytics/governed-sql-api.feature
 */
import { parse } from "@clickhouse/parser";

/**
 * A node of a parsed SQL statement.
 *
 * Deliberately structural: `type` is the discriminant the validator's allowlist
 * is keyed on, and every other field is `unknown` so the walker must decide,
 * field by field, what it recognises. A typed AST union would let a field the
 * walker has never heard of ride along silently — the exact failure the
 * default-deny walk exists to prevent.
 */
export interface SqlAstNode {
  readonly type: string;
  readonly [field: string]: unknown;
}

/** 1-based position in the submitted SQL. Safe to show a caller: it is theirs. */
export interface SqlSourcePosition {
  readonly line: number;
  readonly column: number;
}

/** Outcome of parsing. A parser that throws reports `ok: false`, never escapes. */
export type SqlParseOutcome =
  | { readonly ok: true; readonly statements: readonly SqlAstNode[] }
  | { readonly ok: false; readonly at?: SqlSourcePosition };

/** The narrow seam the validator depends on. */
export interface GovernedSqlParser {
  /** Parses SQL into statements, or reports that it could not. */
  parse(sql: string): SqlParseOutcome;
}

/**
 * Reads a `location` off a thrown parser error without trusting its shape.
 *
 * `@clickhouse/parser` raises a peggy `SyntaxError` carrying
 * `location.start.{line,column}`, but this runs on the catch path of a
 * dependency parsing hostile input — a second failure while reporting the first
 * would turn a rejection into a 500.
 */
function positionOfThrown(error: unknown): SqlSourcePosition | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const start = (error as { location?: { start?: unknown } }).location?.start;
  if (typeof start !== "object" || start === null) return undefined;
  const { line, column } = start as { line?: unknown; column?: unknown };
  if (typeof line !== "number" || typeof column !== "number") return undefined;
  return { line, column };
}

/**
 * The shipped parser: ClickHouse's own TypeScript grammar.
 *
 * Pinned to an exact version in `package.json` rather than a caret range. The
 * package is young and its AST *is* this module's security-relevant contract —
 * a minor release that renames a node type or adds a field would silently
 * change what the validator recognises, and the walk fails closed on anything
 * it does not recognise, so the failure mode of an unreviewed bump is refusing
 * valid customer SQL. Bump it deliberately, with the walk's rule table re-read.
 */
export const clickHouseSqlParser: GovernedSqlParser = {
  parse(sql: string): SqlParseOutcome {
    try {
      const statements = parse(sql);
      // The library's `Statement` union is a set of concrete node shapes; the
      // walker wants the structural view so that unrecognised fields are
      // visible to it. This is the adapter's whole job.
      return {
        ok: true,
        statements: statements as unknown as readonly SqlAstNode[],
      };
    } catch (error) {
      return { ok: false, at: positionOfThrown(error) };
    }
  },
};
