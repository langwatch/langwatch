/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-legacy-filtered-search.feature
 */
import {
  AuthorizedClickHouse,
  type ClickHouseQueryClient,
  type QueryRequest,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { builtOver, mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const PROTECTIONS = { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true };

/** A page of one trace: its count, its id and its summary; every other statement answers none. */
function rowsFor(sql: string): unknown[] {
  if (sql.startsWith("SELECT uniq(TraceId) AS total")) return [{ total: "1" }];
  if (sql.includes("AS sortTime")) return [{ TraceId: "trace-1" }];
  if (sql.includes("ts_SpanCount")) {
    return [traceSummaryRow({ ts_OccurredAt: String(Date.now() - 60_000) })];
  }
  return [];
}

function compose() {
  const member = createApiFixture<TraceClickHouseClient>({
    query: async ({ query }: { query: string }) => ({ json: async () => rowsFor(query) }),
  });
  const clickhouse = new AuthorizedClickHouse({
    resolveClient: async () =>
      clickHouseQueryClientDouble({
        query: async (request: QueryRequest) => ({ rows: rowsFor(request.sql) }),
      }),
  });
  const built: ReadRequest[] = [];
  const builtReader = builtOver(async () => member);
  const repository = mappedLegacyRead({
    clickhouse,
    reader: clickHouseQueryClientDouble({
      read: async (request) => {
        built.push(request);
        return builtReader.read(request);
      },
    }),
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
  return { repository, built };
}

describe("TraceLegacyReadClickHouseRepository page evaluations", () => {
  describe("given a page of traces", () => {
    /** @scenario "A page's evaluations are read by trace id as on main, a declared full scan" */
    it("reads the page's evaluations unbounded by time, declared a full scan", async () => {
      const { repository, built } = compose();

      await repository.listAllTracesForProject(
        {
          projectId: "project-1",
          startDate: Date.now() - 86_400_000,
          endDate: Date.now(),
          pageSize: 10,
          filters: {},
        },
        PROTECTIONS,
        { ownRead: ownProof({ projectId: "project-1" }) },
      );
      const evaluationRead = built.find((request) => request.table === "evaluation_runs");
      expect(evaluationRead?.declaresFullScan).toBe(true);
      expect(evaluationRead?.statement).toMatchObject({ kind: "tenant", tenantIds: ["project-1"] });
      expect(evaluationRead?.statement.sql).not.toMatch(/ScheduledAt\s*>=/);
    });
  });
});
