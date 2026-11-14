/** A tenant's ClickHouse session sends only its own tenant's built reads (ADR-202). */
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { describe, expect, it } from "vitest";

import { simulationRuns } from "../clickhouse.simulation-runs.table.ts";
import { ClickHouseSimulationSession } from "../clickhouse.simulation-session.store.ts";

const sent: string[] = [];
const session = new ClickHouseSimulationSession(
  vendorQueryClient({
    vendor: {
      query: async (input) => {
        sent.push(input.query);
        return { json: async () => [] } as never;
      },
      insert: async () => ({}) as never,
      command: async () => ({}) as never,
    },
    indexes: [],
  }),
  "project_a",
);

const statusRead = (tenantId: string) =>
  clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(simulationRuns)
    .select({ status: simulationRuns.Status })
    .build();

describe("ClickHouseSimulationSession.read()", () => {
  describe("when the statement is scoped to the session's tenant", () => {
    it("sends it", async () => {
      await expect(session.read({ statement: statusRead("project_a") })).resolves.toEqual({
        rows: [],
      });
      expect(sent).toHaveLength(1);
    });
  });

  describe("when the statement is scoped to another tenant", () => {
    it("refuses it by name and sends nothing", async () => {
      sent.length = 0;

      await expect(session.read({ statement: statusRead("project_b") })).rejects.toMatchObject({
        name: "SecurityError",
      });
      expect(sent).toHaveLength(0);
    });
  });
});
