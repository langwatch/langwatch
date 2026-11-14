// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 * Each cost summary read is a built read (ADR-202) scoped to the one tenant it names, sent on the
 * reader identity with that tenant as its setting. Spec: specs/governance/governance-cost-rollup.feature
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST } from "../../governance-cost-rollup.repository.ts";
import { ClickHouseGovernanceCostChargeRepository } from "../clickhouse.governance-cost-charge.repository.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../clickhouse.governance-cost-rollup.repository.ts";
import { ClickHouseRollupErasureRepository } from "../clickhouse.rollup-erasure.repository.ts";

const TENANT = "project-a";
const WINDOW = { tenantId: TENANT, fromDay: "2026-09-01", toDay: "2026-09-30" };
const CELL = {
  TenantId: TENANT,
  Day: "2026-09-02",
  CostSource: "pulled",
  IngestionSourceId: "source-1",
  Provider: "openai",
  Model: "gpt-5",
  AgentId: "",
  CurrencyCode: "USD",
  RawActorId: "actor-1",
};

function recordingClient() {
  const statements: ReaderReadStatement[] = [];
  const client = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [] };
    },
    insert: async () => undefined,
    command: async () => undefined,
  };
  return { client, resolve: async () => client as never, statements };
}

const READS: {
  name: string;
  run: (resolve: () => Promise<never>, client: never) => Promise<unknown>;
}[] = [
  ...(
    [
      ["sumDaysByProvider", (r) => r.sumDaysByProvider(WINDOW)],
      [
        "sumPeriodRecordsByProvider",
        (r) => r.sumPeriodRecordsByProvider({ ...WINDOW, provider: "openai" }),
      ],
      ["sumWindowBySpender", (r) => r.sumWindowBySpender(WINDOW)],
      ["sumWindowByModel", (r) => r.sumWindowByModel(WINDOW)],
      ["sumDaysByLane", (r) => r.sumDaysByLane(WINDOW)],
      ["sumDaysByLane for one lane", (r) => r.sumDaysByLane({ ...WINDOW, costSource: "pulled" })],
      ["sumWindowByProvider", (r) => r.sumWindowByProvider(WINDOW)],
      ["sumWindowByCurrency", (r) => r.sumWindowByCurrency({ ...WINDOW, costSource: "pulled" })],
      [
        "hasRowsForSource",
        (r) =>
          r.hasRowsForSource({ ...WINDOW, costSource: "pulled", ingestionSourceId: "source-1" }),
      ],
      ["findCellRows", (r) => r.findCellRows(CELL)],
      [
        "findCellsForDay",
        (r) => r.findCellsForDay({ tenantId: TENANT, day: CELL.Day, costSource: "pulled" }),
      ],
      [
        "findLatestSummarizedOccurredAt",
        (r) => r.findLatestSummarizedOccurredAt({ tenantId: TENANT, costSource: "pulled" }),
      ],
    ] as const satisfies readonly (readonly [
      string,
      (repository: ClickHouseGovernanceCostRollupRepository) => Promise<unknown>,
    ])[]
  ).map(([name, read]) => ({
    name,
    run: (resolve: () => Promise<never>) =>
      read(ClickHouseGovernanceCostRollupRepository.create(resolve)),
  })),
  {
    name: "findChargesForDay",
    run: (resolve) =>
      ClickHouseGovernanceCostChargeRepository.create(resolve).findChargesForDay({
        tenantId: TENANT,
        day: CELL.Day,
        costSource: "pulled",
      }),
  },
  {
    name: "findLatestChargeOccurredAt",
    run: (resolve) =>
      ClickHouseGovernanceCostChargeRepository.create(resolve).findLatestChargeOccurredAt({
        tenantId: TENANT,
        costSource: "pulled",
      }),
  },
  {
    name: "findDaysCarryingActor",
    run: (_resolve, client) =>
      ClickHouseRollupErasureRepository.create(client).findDaysCarryingActor({
        tenantIds: [TENANT],
        rawActorId: "actor-1",
      }),
  },
];

describe("governance's cost reads as built reads", () => {
  describe("when each cost summary read is sent", () => {
    /** @scenario "Every cost summary read passes the tenant guard" */
    it.each(READS)("$name is scoped to the one tenant it names, on the reader", async (read) => {
      const { client, resolve, statements } = recordingClient();

      await read.run(resolve, client as never);

      expect(statements).toHaveLength(1);
      const [statement] = statements;
      expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: TENANT });
      expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: TENANT });
      expect(statement?.sql).toContain("WHERE TenantId = {tenantId:String}");
      expect(statement?.params.tenantId).toBe(TENANT);
      expect(statement?.sql).not.toContain(TENANT);
    });
  });

  describe("when a cell carrying restatement keys is upserted", () => {
    it("asks the index only for that tenant's keys before writing the unrecorded ones", async () => {
      const { resolve, statements } = recordingClient();
      const row = { PulledItemsJson: JSON.stringify({ "key-1": 1, "key-2": 2 }) };

      await ClickHouseGovernanceCostRollupRepository.create(resolve).upsert({
        ...CELL,
        ...row,
        Version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      } as never);

      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatchObject({ kind: "tenant", tenantId: TENANT });
      expect(statements[0]?.sql).toContain(
        "SELECT DISTINCT RestatementKey FROM governance_cost_rollup_restatement_index",
      );
      expect(Object.values(statements[0]?.params ?? {})).toContainEqual(["key-1", "key-2"]);
    });
  });
});
