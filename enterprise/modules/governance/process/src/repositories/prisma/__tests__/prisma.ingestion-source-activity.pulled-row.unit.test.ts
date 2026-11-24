// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The reads of a source's own rows bind the Security Lake source type as a query parameter
 * rather than splicing it into the SQL text, as the ClickHouse OCSF events reads do.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { clickHouseClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it } from "vitest";

import { PrismaActivityMonitorRepository } from "../prisma.ingestion-source-activity.repository.ts";

type QueryCall = { query: string; query_params: Record<string, unknown> | undefined };

function repositoryRecordingQueries() {
  const calls: QueryCall[] = [];
  const client = clickHouseClientDouble({
    query: async ({ query, query_params }) => {
      calls.push({ query, query_params });
      return { json: async () => [] };
    },
  });
  const repository = PrismaActivityMonitorRepository.create({
    prisma: prismaDouble(),
    clickhouse: { getClient: async () => client },
  });
  return { calls, repository };
}

const scope = { organizationId: "org_1", tenantId: "gov-1" };

describe("PrismaActivityMonitorRepository", () => {
  describe("when it reads the rows a source wrote itself", () => {
    /** @scenario "A source's own page reads its Security Lake rows with the source type bound, not spliced" */
    it("binds the Security Lake source type on every query that selects them", async () => {
      const { calls, repository } = repositoryRecordingQueries();

      await repository.countLoggedAndPulledEventsBySource({
        ...scope,
        sourceIds: ["src_1"],
        sinceMs: 0,
      });
      await repository.findPulledEventsForSource({
        ...scope,
        sourceId: "src_1",
        beforeMs: 1,
        limit: 10,
      });
      await repository.findLoggedAndPulledEventWindows({
        ...scope,
        sourceId: "src_1",
        since24h: 0,
        since7d: 0,
        since30d: 0,
      });

      const pulled = calls.filter((call) => call.query.includes("governance_ocsf_events"));
      expect(pulled).toHaveLength(3);
      for (const call of pulled) {
        expect(call.query).not.toContain("'security_lake'");
        expect(call.query).toContain("{securityLakeSourceType:String}");
        expect(call.query_params).toMatchObject({ securityLakeSourceType: "security_lake" });
      }
    });
  });
});
