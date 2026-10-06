// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ClickHouseQueryClient,
  routingDriver,
  type ClickHouseConnection,
  type RoutableStatementClient,
} from "@langwatch/clickhouse-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { BillableEventsQueryService } from "../../../services/billable-events-query.service.ts";
import { BillableEventsClickHouseRepository } from "../clickhouse.billable-events.repository.ts";

/** A routed ClickHouse that answers one organization, recording every lookup and statement. */
function usagePanelOver(rows: unknown[]) {
  const organizationsResolved: string[] = [];
  const statements: { query: string; query_params: Record<string, unknown> }[] = [];
  const vendor = createApiFixture<RoutableStatementClient>({
    query: async (params) => {
      statements.push(params as (typeof statements)[number]);
      return { json: async () => rows, stream: async function* () {} };
    },
  });
  const connection = createApiFixture<ClickHouseConnection<RoutableStatementClient>>({
    resolveOrganization: (organizationId) => {
      organizationsResolved.push(organizationId);
      return vendor;
    },
  });
  const repository = BillableEventsClickHouseRepository.create(
    new ClickHouseQueryClient({ driver: routingDriver(connection) }),
  );

  return {
    organizationsResolved,
    statements,
    panel: BillableEventsQueryService.create(repository),
  };
}

const READ = {
  organizationId: "org_1",
  projectIds: ["project_1", "project_2"],
  now: Temporal.Instant.from("2026-09-10T00:00:00Z"),
};

describe("BillableEventsClickHouseRepository", () => {
  describe("given an organization whose plan meters it in events", () => {
    /** @scenario "The month's events are read off the organization-keyed rollup" */
    it("reads the month off billable_events scoped by the organization and answers numbers", async () => {
      const { panel, statements } = usagePanelOver([{ projectId: "project_1", total: "7" }]);

      const counts = await panel.countBillableEventsByProjects(READ);

      expect(counts).toEqual([
        { projectId: "project_1", count: 7 },
        { projectId: "project_2", count: 0 },
      ]);
      expect(statements).toHaveLength(1);
      expect(statements[0]?.query).toMatch(
        /FROM billable_events\s+WHERE OrganizationId = \{organizationId:String\}/,
      );
      expect(statements[0]?.query_params).toEqual({
        organizationId: "org_1",
        startDate: "2026-09-01 00:00:00.000",
        endDate: "2026-10-01 00:00:00.000",
      });
    });

    /** @scenario "The organization id never reaches the tenant resolver" */
    it("asks only the organization-keyed accessor, never the tenant, set or shared ones", async () => {
      const { panel, organizationsResolved } = usagePanelOver([
        { projectId: "project_1", total: 3 },
      ]);

      await panel.countBillableEventsByProjects(READ);

      expect(organizationsResolved).toEqual(["org_1"]);
    });
  });
});
