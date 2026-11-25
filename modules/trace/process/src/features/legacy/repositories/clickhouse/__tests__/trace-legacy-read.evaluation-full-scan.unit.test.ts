/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-legacy-filtered-search.feature
 */
import { AuthorizedClickHouse, type QueryRequest } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaryRow } from "../../../../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

const PROTECTIONS = { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true };

/** A page of one trace: its count, its id and its summary; every other statement answers none. */
function rowsFor(sql: string): unknown[] {
  if (sql.includes("as total")) return [{ total: "1" }];
  if (sql.includes("SELECT s.TraceId")) return [{ TraceId: "trace-1" }];
  if (sql.includes("ts_SpanCount")) {
    return [traceSummaryRow({ ts_OccurredAt: String(Date.now() - 60_000) })];
  }
  return [];
}

function compose() {
  const requests: QueryRequest[] = [];
  const member = createApiFixture<TraceClickHouseClient>({
    query: async ({ query }: { query: string }) => ({ json: async () => rowsFor(query) }),
  });
  const clickhouse = new AuthorizedClickHouse({
    resolveClient: async () =>
      clickHouseQueryClientDouble({
        query: async (request: QueryRequest) => {
          requests.push(request);
          return { rows: rowsFor(request.sql) };
        },
      }),
  });
  const repository = mappedLegacyRead({
    clickhouse,
    resolveClickHouseClient: async () => member,
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
  return { repository, requests };
}

describe("TraceLegacyReadClickHouseRepository page evaluations", () => {
  describe("given a page of traces", () => {
    /** @scenario "A page's evaluations are read by trace id as on main, a declared full scan" */
    it("reads the page's evaluations unbounded by time, declared a full scan", async () => {
      const { repository, requests } = compose();

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
      const evaluationRead = requests.find((request) =>
        request.sql.includes("FROM evaluation_runs"),
      );
      expect(evaluationRead?.SKIP_COLD_SCAN_CHECK).toBe(true);
      expect(evaluationRead?.sql).not.toMatch(/ScheduledAt\s*>=/);
    });
  });
});
