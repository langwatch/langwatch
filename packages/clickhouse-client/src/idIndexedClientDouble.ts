/**
 * The process's client over a scripted driver with id indexes declared, for unit tests of reads
 * that carry `{{idBound}}`: the marker expands exactly as the real client expands it. Readiness
 * statements never reach the script; every index reads as not filled, or filled once marked.
 */
import { ClickHouseQueryClient } from "./client.ts";
import type { IdIndexDeclaration } from "./idIndexFill.ts";
import { SHARED_CLICKHOUSE_TARGET } from "./idIndexFlags.ts";
import { isIdIndexReadinessStatement } from "./idIndexReadiness.ts";
import type { InsertRequest, QueryDriver, QueryRequest, QueryResult } from "./query.ts";
import { TenantGuard } from "./tenantGuard.ts";

/** What a test scripts: every statement the reads send, answered with plain rows, and writes. */
export interface ScriptedStatements {
  execute(request: QueryRequest): Promise<{ rows: readonly unknown[] }>;
  insert?(request: InsertRequest): Promise<void>;
}

/** The test's rows as the reader asked for them; a double answers whatever the test scripted. */
const asScriptedRows = <Row>(rows: readonly unknown[]): Row[] =>
  rows.filter((_row): _row is Row => true);

/** A client whose declared indexes read as not filled: every read takes today's path. */
export function idIndexedClientDouble({
  indexes,
  driver,
}: {
  indexes: readonly IdIndexDeclaration[];
  /** Answers every statement but the readiness checks, as a test scripts it. */
  driver: ScriptedStatements;
}): ClickHouseQueryClient {
  return clientOver({ indexes, driver, ready: false });
}

/** A client whose declared indexes read as filled on the shared target, checked up front. */
export async function readyIdIndexedClientDouble({
  indexes,
  driver,
}: {
  indexes: readonly IdIndexDeclaration[];
  driver: ScriptedStatements;
}): Promise<ClickHouseQueryClient> {
  const client = clientOver({ indexes, driver, ready: true });
  for (const index of indexes) {
    const { source, key } = index;
    await client.idIndexes().check({ source, key, target: SHARED_CLICKHOUSE_TARGET });
  }
  return client;
}

function clientOver({
  indexes,
  driver: scripted,
  ready,
}: {
  indexes: readonly IdIndexDeclaration[];
  driver: ScriptedStatements;
  ready: boolean;
}): ClickHouseQueryClient {
  const driver: QueryDriver = {
    execute: <Row>(request: QueryRequest): Promise<QueryResult<Row>> => {
      if (!isIdIndexReadinessStatement(request)) {
        return scripted.execute(request).then(({ rows }) => ({ rows: asScriptedRows<Row>(rows) }));
      }
      // Ready reads an empty source, which marks it filled; not ready fails the check.
      if (ready) return Promise.resolve({ rows: [] });
      return Promise.reject(new Error("the id index double is not ready"));
    },
    insert: async (request) => scripted.insert?.(request),
    command: async () => {},
  };
  const client = new ClickHouseQueryClient({ driver, tenantGuard: new TenantGuard() });
  client.declareIdIndexes({ indexes });
  return client;
}
