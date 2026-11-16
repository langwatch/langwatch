/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-legacy-filtered-search.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { GetAllTracesForProjectInput } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

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

      const first = query.mock.calls.at(0)?.at(0);
      const bound = /ContainsErrorStatus = \{(\w+):Bool\}/.exec(first?.query ?? "");
      expect(first?.query_params?.[bound![1]!]).toBe(true);
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
      expect(first?.query).not.toContain("otlp2");
      // Bound JSON-quoted, as main's `concat('"', x, '"')` compared the raw array elements.
      expect(Object.values(first?.query_params ?? {})).toContainEqual(['"otlp2"']);
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

  describe("given a span filter, which reads stored_spans", () => {
    it("reads the span subquery under the own proof's project, as the page does", async () => {
      const { repository, query } = compose();

      await repository.listAllTracesForProject(search({ "spans.type": ["llm"] }), PROTECTIONS, {
        ownRead: OWN_READ,
      });

      const [count] = query.mock.calls.map((call) => call[0]);
      const subquery = count!.query.slice(count!.query.indexOf("FROM stored_spans"));
      expect(subquery).toMatch(
        /^FROM stored_spans WHERE \(TenantId IN \(\{(\w+):Array\(String\)\}\)\)/,
      );
      const tenantParam = /TenantId IN \(\{(\w+):Array\(String\)\}\)/.exec(subquery)![1]!;
      expect(count!.query_params?.[tenantParam]).toEqual(["project-1"]);
      expect(Object.values(count!.query_params ?? {})).toContainEqual(["llm"]);
    });
  });
});
