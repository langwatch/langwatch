// Smoke-test v3 — DO NOT MERGE. ClickHouse heavy-column dedup anti-pattern
// (clickhouse-queries.md anti-pattern 1).

export async function getLatestRow(tenantId: string, key: string): Promise<unknown> {
  // VIOLATION: heavy columns (Messages, ComputedInput) + ORDER BY UpdatedAt DESC LIMIT 1.
  // Also VIOLATION: missing TenantId filter shape `{tenantId:String}`.
  const sql = `
    SELECT Messages, ComputedInput, Inputs
    FROM trace_events
    WHERE Key = '${key}'
    ORDER BY UpdatedAt DESC
    LIMIT 1
  `;
  return await clickhouse.query({ query: sql });
}

declare const clickhouse: { query: (args: { query: string }) => Promise<unknown> };
