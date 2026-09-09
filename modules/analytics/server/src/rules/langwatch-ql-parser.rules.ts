/**
 * LangWatchQL analytics SQL — the parser seam. The validator walks a tree of `{ type, ...fields
 * }` nodes and knows nothing about how that tree was produced.
 * @see specs/analytics/lwql-api.feature
 */
import { parse } from "@clickhouse/parser";

/**
 * A node of a parsed SQL statement. Deliberately structural: `type` is the discriminant the
 * validator's allowlist is keyed on, and every other field is `unknown` so the walker must
 * decide, field by field, what it recognises.
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
export interface LangWatchQLParser {
  /** Parses SQL into statements, or reports that it could not. */
  parse(sql: string): SqlParseOutcome;
}

/**
 * Reads a `location` off a thrown parser error without trusting its shape.
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
 * The shipped parser: ClickHouse's own TypeScript grammar. Pinned to an exact version in
 * `package.json` rather than a caret range.
 */
export const clickHouseSqlParser: LangWatchQLParser = {
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
