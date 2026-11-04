/**
 * A statement run for a private route names the database that route's executor dials. The
 * service qualifies SQL once, with the shared connection's database; the routed executor then
 * dials the route's own, so a qualifier left at the shared name points at a database the
 * private server need not have.
 * @see specs/lwql/api.feature
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { RoutedLangWatchQLExecutorRepository } from "../../repositories/clickhouse/clickhouse.langwatch-ql-routed-executor.repository.ts";
import {
  type LangWatchQLConnection,
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../../repositories/langwatch-ql-executor.repository.ts";
import { LangWatchQLService } from "../langwatch-ql.service.ts";
import { EVERY_CATALOGUE_PERMISSION } from "./lwql-catalogue-access.fixture.ts";

const SHARED: LangWatchQLConnection = {
  url: "http://shared.invalid:8123",
  username: "langwatch_lwql",
  password: "lwql-secret",
  database: "analytics",
  tenantSetting: "custom_lwql_key_hash",
};
const PRIVATE_URL = "https://route-user:route-password@private.invalid:8443/acme_db";
const WINDOW = { start: "2026-02-01T00:00:00.000Z", end: "2026-02-04T00:00:00.000Z" };
const PERIOD_SQL =
  "SELECT count() AS n FROM analytics.trace_metrics " +
  "WHERE OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime} LIMIT 1";

class RecordingExecutor extends LangWatchQLExecutorRepository {
  readonly requests: LangWatchQLExecutionRequest[] = [];

  constructor(readonly connection: LangWatchQLConnection) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.requests.push(request);

    return Promise.resolve({
      columns: [{ name: "n", type: "UInt64" }],
      rows: [],
      statistics: { elapsedMs: 1, rowsRead: 0, bytesRead: 0, rowsReturned: 0 },
    });
  }
}

function privateRun(input: {
  sql: string;
  timeWindow?: typeof WINDOW;
  memberWindows?: { projectId: string; from: number }[];
}) {
  const executors: RecordingExecutor[] = [];
  const routed = RoutedLangWatchQLExecutorRepository.create({
    connection: SHARED,
    route: () =>
      Promise.resolve({ kind: "private", organizationId: "org-private", url: PRIVATE_URL }),
    createExecutor: ({ connection }) => {
      const executor = new RecordingExecutor(connection);
      executors.push(executor);
      return executor;
    },
  });
  const service = LangWatchQLService.create({ executor: routed, database: SHARED.database });
  const done = service.executeForProjects({
    projects: [{ id: "project-1", lwqlKey: "key-1" }],
    protections: {
      catalogue: EVERY_CATALOGUE_PERMISSION,
      canSeeCosts: true,
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
    },
    ...input,
  });

  return { done, privateExecutor: () => executors.find((e) => e.connection.url !== SHARED.url) };
}

/** Every `database.` that precedes a table name in the SQL the server was handed. */
function qualifiersOf(requests: readonly LangWatchQLExecutionRequest[]): string[] {
  return requests.flatMap(({ sql }) =>
    [...sql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_]\w*)\.\w+/gi)].map((match) => match[1]!),
  );
}

describe("given a statement for an organization whose route names its own database", () => {
  /** @scenario "A LangWatchQL query for an organization with a private ClickHouse runs on that ClickHouse as the LangWatchQL identity" */
  it("qualifies the statement with the database the private executor dials", async () => {
    const { done, privateExecutor } = privateRun({
      sql: "SELECT count() AS n FROM analytics.trace_metrics LIMIT 1",
    });
    await done;

    const dialled = privateExecutor()?.connection.database;
    expect(dialled).toBe("acme_db");
    expect(qualifiersOf(privateExecutor()?.requests ?? [])).toEqual([dialled]);
  });

  it("qualifies the completeness read with that database too", async () => {
    const { done, privateExecutor } = privateRun({ sql: PERIOD_SQL, timeWindow: WINDOW });
    await done;

    const requests = privateExecutor()?.requests ?? [];
    expect(requests.length).toBeGreaterThan(1);
    expect(new Set(qualifiersOf(requests))).toEqual(new Set([privateExecutor()?.connection.database]));
  });

  it("qualifies a dated member's window and its trace lookup with that database", async () => {
    const { done, privateExecutor } = privateRun({
      sql: "SELECT count() AS n FROM analytics.evaluations LIMIT 1",
      memberWindows: [{ projectId: "project-1", from: 1_760_000_000_000 }],
    });
    await done;

    const requests = privateExecutor()?.requests ?? [];
    expect(requests[0]?.sql).toContain("traces");
    expect(new Set(qualifiersOf(requests))).toEqual(new Set([privateExecutor()?.connection.database]));
  });
});
