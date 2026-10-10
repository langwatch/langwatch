/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-legacy-filtered-search.feature
 */
import { tenantScope } from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { GetAllTracesForProjectInput } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";
import { boundedSubquery } from "#features/query/rules/trace-query-subquery.rules";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceClickHouseClient } from "../../../../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

const OWN_READ = ownProof({ projectId: "project-1" });

const PROTECTIONS = { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true };

function compose() {
  const query = vi.fn(
    async (_input: { query: string; query_params?: Record<string, unknown> }) => ({
      json: async (): Promise<unknown[]> => [],
    }),
  );
  const client = createApiFixture<TraceClickHouseClient>({ query });
  const repository = mappedLegacyRead({
    resolveClickHouseClient: async () => client,
    traceCanonicalisation: TraceCanonicalisationService.create(),
  });
  return { repository, query };
}

function search(filters: GetAllTracesForProjectInput["filters"]): GetAllTracesForProjectInput {
  return {
    projectId: "project-1",
    startDate: Date.now() - 86_400_000,
    endDate: Date.now(),
    pageSize: 10,
    filters,
  };
}

describe("TraceLegacyReadClickHouseRepository filtered list", () => {
  describe("given an errors-only filter", () => {
    /** @scenario "A filtered legacy search answers the filtered traces" */
    it("narrows the count query by the error condition", async () => {
      const { repository, query } = compose();

      await repository.listAllTracesForProject(search({ "traces.error": ["true"] }), PROTECTIONS, {
        ownRead: OWN_READ,
      });

      expect(query.mock.calls.at(0)?.at(0)?.query).toContain("ts.ContainsErrorStatus = true");
    });
  });

  describe("given a label filter", () => {
    /** @scenario "A label filter binds its values as parameters" */
    it("binds the label as a parameter rather than inlining it", async () => {
      const { repository, query } = compose();

      await repository.listAllTracesForProject(
        search({ "metadata.labels": ["otlp2"] }),
        PROTECTIONS,
        { ownRead: OWN_READ },
      );

      const first = query.mock.calls.at(0)?.at(0);
      expect(first?.query).not.toContain("'otlp2'");
      expect(Object.values(first?.query_params ?? {})).toContainEqual(["otlp2"]);
    });
  });

  describe("given a filter field the grammar does not know", () => {
    /** @scenario "A filter field the grammar does not know is refused, not answered with every trace" */
    it("fails the read instead of listing the whole project", async () => {
      const { repository, query } = compose();

      await expect(
        repository.listAllTracesForProject(search({ "bogus.field": ["x"] }), PROTECTIONS, {
          ownRead: OWN_READ,
        }),
      ).rejects.toThrow(/unsupported fields/);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("given a compiled filter whose span clause carries a tenant marker", () => {
    const filterWhere = {
      sql: boundedSubquery("stored_spans", "StartTime", "SpanName = {spanName:String}"),
      params: { timeFrom: 1000, timeTo: 5000, spanName: "llm" },
    };

    it("expands the marker into the proof's own project", async () => {
      const { repository, query } = compose();

      await repository.listAllTracesForProject(search({}), PROTECTIONS, {
        filterWhere,
        authorization: ownProof({ projectId: "project-1" }),
        ownRead: OWN_READ,
      });

      const statements = query.mock.calls.map((call) => call[0]);
      expect(statements.some((statement) => statement.query.includes("stored_spans"))).toBe(true);
      for (const statement of statements) {
        expect(statement.query).not.toContain(tenantScope("StartTime"));
      }
      expect(Object.values(statements[0]?.query_params ?? {})).toContainEqual(["project-1"]);
    });

    it("refuses the read without a proof", async () => {
      const { repository, query } = compose();

      await expect(
        repository.listAllTracesForProject(search({}), PROTECTIONS, {
          filterWhere,
          ownRead: OWN_READ,
        }),
      ).rejects.toThrow(/needs the proof/);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
