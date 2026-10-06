/** @vitest-environment node */

/**
 * The metered lane's day read on the spend record: each request at its latest
 * version, summed on the day it started. Per-run tenant ids keep the read exact.
 * @see specs/governance/governance-cost-screen.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GatewaySpendState } from "../../../eventing/gateway-spend.projection.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";
import { startMigratedGatewayClickHouse } from "./support/migrated-clickhouse.harness.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const MINUTE = 60_000;

const NANO_PER_USD = 1_000_000_000;

let client: ClickHouseClient;
let repo: ClickHouseGatewaySpendEventsRepository;

function state({
  status,
  occurredAtMs,
  updatedAt,
  costNanoUsd,
  lastEventAtMs = occurredAtMs,
}: {
  status: GatewaySpendState["status"];
  occurredAtMs: number;
  updatedAt: number;
  costNanoUsd: number;
  lastEventAtMs?: number;
}): GatewaySpendState {
  return {
    status,
    organizationId: `org-${run}`,
    virtualKeyId: `vk-${run}`,
    principalUserId: `user-${run}`,
    endUserId: "",
    model: "openai/gpt-5-mini",
    providerKey: `prov-${run}`,
    traceId: `trace-${run}`,
    requestType: "chat",
    labels: [],
    metadataJson: "{}",
    podId: `pod-${run}`,
    podSeq: 1,
    usage: null,
    rateVersion: "catalog@test",
    costNanoUsd,
    errorType: "",
    httpStatus: 0,
    needsReconciliation: false,
    settleReason: "",
    occurredAtMs,
    durationMs: 0,
    createdAt: occurredAtMs,
    updatedAt,
    LastEventOccurredAt: lastEventAtMs,
  };
}

/** One fold commit per call, so a request's versions land as separate parts. */
async function fold({
  tenantId,
  requestId,
  at,
}: {
  tenantId: string;
  requestId: string;
  at: GatewaySpendState;
}): Promise<void> {
  await repo.upsertFromFold([{ tenantId, gatewayRequestId: requestId, state: at }]);
}

describe.skipIf(!enabled)("the metered day read on the spend record (real ClickHouse)", () => {
  const tenants = {
    charged: `metered-charged-${run}`,
    twoMonths: `metered-two-months-${run}`,
    midnight: `metered-midnight-${run}`,
  };

  beforeAll(async () => {
    ({ client } = await startMigratedGatewayClickHouse());
    repo = new ClickHouseGatewaySpendEventsRepository(async () => client);
    // Both versions of a request stay on disk until the query has read them.
    await client.command({ query: "SYSTEM STOP MERGES gateway_spend" });
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({ query: "SYSTEM START MERGES gateway_spend" });
    for (const tenantId of Object.values(tenants)) {
      await client.command({
        query: "ALTER TABLE gateway_spend DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
    }
  }, 120_000);

  describe("given a confirmed request and a failed one priced for the tokens it consumed", () => {
    /** @scenario A failed request that consumed tokens still counts as metered spend */
    it("counts both requests' amounts in the day's total", async () => {
      const at = Date.UTC(2026, 5, 10, 9, 0, 0);
      await fold({
        tenantId: tenants.charged,
        requestId: `req-ok-${run}`,
        at: state({
          status: "confirmed",
          occurredAtMs: at,
          updatedAt: at + 1,
          costNanoUsd: 3 * NANO_PER_USD,
        }),
      });
      await fold({
        tenantId: tenants.charged,
        requestId: `req-failed-${run}`,
        at: state({
          status: "failed",
          occurredAtMs: at,
          updatedAt: at + 2,
          costNanoUsd: NANO_PER_USD,
        }),
      });

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [tenants.charged],
        fromDay: "2026-06-10",
        toDay: "2026-06-10",
      });

      expect(days).toEqual([
        expect.objectContaining({
          day: "2026-06-10",
          amountNanoUsd: 4 * NANO_PER_USD,
          requestCount: 2,
          pricedRequestCount: 2,
        }),
      ]);
    });
  });

  describe("given a request whose admission moved its start time into the previous month", () => {
    /** @scenario A request written into two months is counted once */
    it("counts the amount exactly once across both months", async () => {
      const requestId = `req-two-months-${run}`;
      const july = Date.UTC(2026, 6, 1, 0, 5, 0);
      const june = Date.UTC(2026, 5, 30, 23, 55, 0);
      const cost = 2 * NANO_PER_USD;
      await fold({
        tenantId: tenants.twoMonths,
        requestId,
        at: state({ status: "confirmed", occurredAtMs: july, updatedAt: july, costNanoUsd: cost }),
      });
      await fold({
        tenantId: tenants.twoMonths,
        requestId,
        at: state({
          status: "confirmed",
          occurredAtMs: june,
          updatedAt: july + MINUTE,
          costNanoUsd: cost,
          lastEventAtMs: july,
        }),
      });

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [tenants.twoMonths],
        fromDay: "2026-06-01",
        toDay: "2026-07-31",
      });

      expect(days.map(({ day, amountNanoUsd }) => [day, amountNanoUsd])).toEqual([
        ["2026-06-30", cost],
      ]);
      expect(days.reduce((sum, { amountNanoUsd }) => sum + amountNanoUsd, 0)).toBe(cost);
    });
  });

  describe("given a request admitted ten minutes before midnight UTC and answered after it", () => {
    /** @scenario A stream crossing midnight belongs to the day it started */
    it("puts the whole amount on the day the request started and none on the next", async () => {
      const requestId = `req-midnight-${run}`;
      const started = Date.UTC(2026, 7, 20, 23, 50, 0);
      const finished = Date.UTC(2026, 7, 21, 0, 4, 0);
      const cost = 5 * NANO_PER_USD;
      await fold({
        tenantId: tenants.midnight,
        requestId,
        at: state({
          status: "admitted",
          occurredAtMs: started,
          updatedAt: started,
          costNanoUsd: 0,
        }),
      });
      await fold({
        tenantId: tenants.midnight,
        requestId,
        at: state({
          status: "confirmed",
          occurredAtMs: started,
          updatedAt: finished,
          costNanoUsd: cost,
          lastEventAtMs: finished,
        }),
      });

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [tenants.midnight],
        fromDay: "2026-08-20",
        toDay: "2026-08-21",
      });

      expect(days.map(({ day, amountNanoUsd }) => [day, amountNanoUsd])).toEqual([
        ["2026-08-20", cost],
      ]);
    });
  });
});
