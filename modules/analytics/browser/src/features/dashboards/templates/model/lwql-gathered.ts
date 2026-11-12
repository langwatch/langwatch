/**
 * Gathered rows: a part of a LangWatchQL query run whole, by a scalar subquery, before the query
 * around it starts.
 */

/**
 * The rows of `sql`, gathered by a scalar subquery, which ClickHouse runs to the end before the
 * rest of the query: its working memory is freed first, where parts run side by side together
 * passed the per-query memory cap that each stays under alone.
 */
export function gatheredRows({ sql, columns }: { sql: string; columns: string[] }): string {
  const picked = columns.map((column, index) => `gathered.${index + 1} AS ${column}`).join(", ");
  return `SELECT ${picked}
  FROM (
    SELECT arrayJoin((
      SELECT groupArray(tuple(${columns.join(", ")}))
      FROM (${sql})
    )) AS gathered
  )`;
}
