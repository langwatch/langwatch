/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-legacy-filtered-search.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { GetAllTracesForProjectInput } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#services/trace-canonicalisation.service";

import type { TraceClickHouseClient } from "../clickhouse.trace-member-client.repository.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";

const PROTECTIONS = { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true };

function compose() {
  const query = vi.fn(
    async (_input: { query: string; query_params?: Record<string, unknown> }) => ({
      json: async (): Promise<unknown[]> => [],
    }),
  );
  const client = createApiFixture<TraceClickHouseClient>({ query });
  const repository = new TraceLegacyReadClickHouseRepository({
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

      await repository.listAllTracesForProject(search({ "traces.error": ["true"] }), PROTECTIONS);

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
        repository.listAllTracesForProject(search({ "bogus.field": ["x"] }), PROTECTIONS),
      ).rejects.toThrow(/unsupported fields/);
      expect(query).not.toHaveBeenCalled();
    });
  });
});
