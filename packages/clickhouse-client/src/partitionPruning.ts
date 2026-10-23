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

/**
 * The pruned part count of each `ReadFromMergeTree` in an EXPLAIN, from its Partition stage.
 * Reads both plan layouts: the indented one before 26.7 and the `pretty` tree from it
 * (`explain_query_plan_default`), whose lines carry box-drawing prefixes. A stage is named one
 * level under `Indexes:`, so a bare key name deeper down is not mistaken for one.
 */
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
  let stageDepth: number | undefined;
  for (const line of lines) {
    const depth = TREE_PREFIX.exec(line)?.[0].length ?? 0;
    const text = line.slice(depth).trim();
    if (text.startsWith("ReadFromMergeTree")) {
      settle();
      continue;
    }
    if (text === "Indexes:") stageDepth = depth + 2;
    if (depth === stageDepth && /^[A-Za-z-]+$/.test(text)) section = text;
    const parts = /^Parts: (\d+)\/(\d+)$/.exec(text);
    if (!parts) continue;
    entering ??= Number(parts[2]);
    if (section === "Partition") pruned = Number(parts[1]);
  }
  settle();
  return total;
}

/** The `pretty` plan's tree glyphs and the indentation before them. */
const TREE_PREFIX = /^[\s\u2500-\u257F]+/u;
