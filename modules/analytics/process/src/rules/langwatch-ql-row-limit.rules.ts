/**
 * The one edit this API makes to a submitted statement: the default row `LIMIT`, appended when
 * the validator says the statement names none (`appendRowLimit`).
 * @see specs/lwql/api.feature
 */
import type { SqlSourcePosition } from "@langwatch/analytics-contract";

/**
 * Appends `LIMIT maxRows` on its own line, after stripping a trailing `;`, so a trailing line
 * comment cannot swallow it. With `beforeOffset`, ClickHouse's `LIMIT n OFFSET m` order puts it
 * immediately before that statement's `OFFSET` keyword instead.
 */
export function appendDefaultRowLimit({
  sql,
  maxRows,
  beforeOffset,
}: {
  sql: string;
  maxRows: number;
  beforeOffset?: SqlSourcePosition;
}): string {
  if (beforeOffset) {
    // The position names the OFFSET's value, not the keyword, which has no node of its own.
    const keywordAt = lastOffsetKeywordIndex({
      sql,
      before: charIndexOfPosition({ sql, position: beforeOffset }),
    });
    if (keywordAt !== -1) {
      return `${sql.slice(0, keywordAt)}LIMIT ${maxRows} ${sql.slice(keywordAt)}`;
    }
  }
  const trimmed = sql.replace(/;\s*$/u, "").replace(/\s+$/u, "");
  return `${trimmed}\nLIMIT ${maxRows}`;
}

/** A parser's 1-based `{ line, column }` as a character index into `sql`. */
function charIndexOfPosition({
  sql,
  position,
}: {
  sql: string;
  position: SqlSourcePosition;
}): number {
  const lines = sql.split("\n");
  let index = 0;
  for (let line = 0; line < position.line - 1; line++) {
    index += (lines[line]?.length ?? 0) + 1;
  }
  return index + (position.column - 1);
}

/** The start of the last `OFFSET` keyword before `before`, or -1 as `lastIndexOf` answers. */
function lastOffsetKeywordIndex({ sql, before }: { sql: string; before: number }): number {
  let found = -1;
  for (const match of sql.matchAll(/\bOFFSET\b/giu)) {
    if (match.index >= before) break;
    found = match.index;
  }
  return found;
}
