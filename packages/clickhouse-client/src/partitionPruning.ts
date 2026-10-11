/**
 * Test support: how many parts a statement reads once the planner has pruned by partition, read
 * from `EXPLAIN indexes = 1`. Exported through `@langwatch/clickhouse-client/testing`.
 */

/** Runs one query on the test server and answers its rows, as JSONEachRow parses them. */
export type ExplainQuery = (query: string, params?: Record<string, unknown>) => Promise<unknown[]>;

/**
 * The parts left once the planner has pruned by partition, summed over every table scan the
 * statement makes. The key is left out on purpose: this counts what the time bound alone rules out.
 */
export async function partsAfterPartitionPruning({
  query,
  request,
}: {
  query: ExplainQuery;
  request: { sql: string; params?: Record<string, unknown> | undefined };
}): Promise<number> {
  const rows = await query(`EXPLAIN indexes = 1 ${request.sql}`, request.params);
  return partsInExplain(rows.map((row) => String(Reflect.get(Object(row), "explain"))));
}

/** The pruned part count of each `ReadFromMergeTree` in an EXPLAIN, from its Partition stage. */
export function partsInExplain(lines: readonly string[]): number {
  let total = 0;
  let section = "";
  let entering: number | undefined;
  let pruned: number | undefined;
  const settle = () => {
    if (entering !== undefined) total += pruned ?? entering;
    entering = undefined;
    pruned = undefined;
  };
  for (const line of lines) {
    const text = line.trim();
    if (text.startsWith("ReadFromMergeTree")) {
      settle();
      continue;
    }
    if (/^[A-Za-z]+$/.test(text)) section = text;
    const parts = /^Parts: (\d+)\/(\d+)$/.exec(text);
    if (!parts) continue;
    entering ??= Number(parts[2]);
    if (section === "Partition") pruned = Number(parts[1]);
  }
  settle();
  return total;
}
