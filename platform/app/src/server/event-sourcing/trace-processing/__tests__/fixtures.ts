import type { ClickHouseClient, QueryOptions } from "@langwatch/clickhouse";
import type { CanonicalSpan } from "../schema";

export const TRACE_ID = "a".repeat(32);

export function canonicalSpan(
  overrides: Partial<CanonicalSpan> = {},
): CanonicalSpan {
  return {
    tenantId: "tenant-1",
    traceId: TRACE_ID,
    spanId: "b".repeat(16),
    parentSpanId: null,
    name: "root",
    kind: "SERVER",
    startTimeUnixMs: 1_000,
    endTimeUnixMs: 2_000,
    statusCode: "OK",
    statusMessage: null,
    exceptionMessage: null,
    attributes: {},
    resourceAttributes: {},
    instrumentationScopeName: "test",
    instrumentationScopeVersion: null,
    events: [],
    links: [],
    spanType: null,
    model: null,
    usage: {
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      estimated: false,
    },
    cost: { cost: null, nonBilledCost: null },
    io: {
      inputText: null,
      inputIsExplicit: false,
      outputText: null,
      outputIsExplicit: false,
    },
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    prompt: null,
    piiRedactionLevel: "ESSENTIAL",
    piiRedactionStatus: null,
    occurredAt: 1_000,
    acceptedAt: 1_500,
    ...overrides,
  };
}

export interface FakeClickHouseClient extends ClickHouseClient {
  readonly queryCalls: QueryOptions[];
  readonly insertCalls: {
    table: string;
    columns: readonly string[];
    rows: unknown[][];
  }[];
}

export function createFakeClient(
  args: {
    rows?: unknown[][];
    header?: { names: string[]; types: string[] };
  } = {},
): FakeClickHouseClient {
  const queryCalls: QueryOptions[] = [];
  const insertCalls: FakeClickHouseClient["insertCalls"] = [];
  return {
    queryCalls,
    insertCalls,
    async query(options) {
      queryCalls.push(options);
      return { rows: args.rows ?? [], header: args.header };
    },
    stream(): AsyncIterable<unknown[][]> {
      throw new Error("not used by these tests");
    },
    async insert(options) {
      insertCalls.push({
        table: options.table,
        columns: options.columns,
        rows: options.rows,
      });
    },
    async command(): Promise<void> {
      throw new Error("not used by these tests");
    },
    async close() {
      // Nothing to release: there is no real connection behind this fake.
    },
  };
}

/** Substitutes each bound `Identifier` back in, so a query shape is readable. */
export function readable(call: { sql: string; params?: unknown }): string {
  const params = (call.params ?? {}) as Record<string, unknown>;
  return call.sql.replace(/\{(id\d+):Identifier\}/g, (_match, key: string) =>
    String(params[key]),
  );
}
