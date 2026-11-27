/** @vitest-environment node */

/**
 * The staff investigation read of gateway spend per day, virtual key and provider: each request
 * once at its latest version, a failed request counted as failed, at its latest cost.
 * @see modules/staff-access/specs/staff-access-functions-activity.feature
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
const DAY_MS = 24 * 60 * 60 * 1000;
const NANO_PER_USD = 1_000_000_000;
const tenantId = `daily-key-spend-${run}`;
const day = Math.floor(Date.now() / DAY_MS) * DAY_MS - 2 * DAY_MS;

let client: ClickHouseClient;
let repo: ClickHouseGatewaySpendEventsRepository;

function state({
  status,
  virtualKeyId,
  updatedAt,
  costNanoUsd,
}: {
  status: GatewaySpendState["status"];
  virtualKeyId: string;
  updatedAt: number;
  costNanoUsd: number;
}): GatewaySpendState {
  const occurredAtMs = day + 3_600_000;
  return {
    status,
    organizationId: `org-${run}`,
    virtualKeyId,
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
    LastEventOccurredAt: occurredAtMs,
  };
}

async function fold(requestId: string, at: GatewaySpendState): Promise<void> {
  await repo.upsertFromFold([{ tenantId, gatewayRequestId: requestId, state: at }]);
}

describe.skipIf(!enabled)(
  "gateway spend per day, virtual key and provider (real ClickHouse)",
  () => {
    beforeAll(async () => {
      ({ client } = await startMigratedGatewayClickHouse());
      repo = new ClickHouseGatewaySpendEventsRepository(async () => client);
      await client.command({ query: "SYSTEM STOP MERGES gateway_spend" });
      const at = day + 3_600_000;
      await fold(
        `req-a-${run}`,
        state({
          status: "admitted",
          virtualKeyId: `vk-a-${run}`,
          updatedAt: at,
          costNanoUsd: NANO_PER_USD,
        }),
      );
      await fold(
        `req-a-${run}`,
        state({
          status: "failed",
          virtualKeyId: `vk-a-${run}`,
          updatedAt: at + 1_000,
          costNanoUsd: 0,
        }),
      );
      await fold(
        `req-b-${run}`,
        state({
          status: "confirmed",
          virtualKeyId: `vk-b-${run}`,
          updatedAt: at,
          costNanoUsd: 2 * NANO_PER_USD,
        }),
      );
    }, 120_000);

    afterAll(async () => {
      if (!client) return;
      await client.command({ query: "SYSTEM START MERGES gateway_spend" });
      await client.command({
        query: "ALTER TABLE gateway_spend DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
      });
    }, 120_000);

    /** @scenario "Gateway spend per day counts each request once at its latest status" */
    it("counts each request once, the failed one as failed, at its latest cost", async () => {
      const rows = await repo.findDailyKeySpend({
        projectIds: [tenantId],
        since: day - 7 * DAY_MS,
        until: day + DAY_MS,
      });

      expect(rows.toSorted((a, b) => a.virtualKeyId.localeCompare(b.virtualKeyId))).toEqual([
        {
          projectId: tenantId,
          day,
          virtualKeyId: `vk-a-${run}`,
          providerId: `prov-${run}`,
          requests: 1,
          failedRequests: 1,
          spendUsd: 0,
        },
        {
          projectId: tenantId,
          day,
          virtualKeyId: `vk-b-${run}`,
          providerId: `prov-${run}`,
          requests: 1,
          failedRequests: 0,
          spendUsd: 2,
        },
      ]);
    });
  },
);
