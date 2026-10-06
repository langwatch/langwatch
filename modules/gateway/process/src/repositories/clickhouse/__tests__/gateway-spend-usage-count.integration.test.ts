/** @vitest-environment node */

/**
 * The usage report's gateway figures, read from the spend record: each request once at its
 * latest version, lifetime and over a window, and the first request dated from the oldest row.
 * @see specs/self-hosting/connected-services/usage-report.feature
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
const now = Date.now();

let client: ClickHouseClient;
let repo: ClickHouseGatewaySpendEventsRepository;

function state({
  status,
  occurredAtMs,
  updatedAt,
  costNanoUsd,
}: {
  status: GatewaySpendState["status"];
  occurredAtMs: number;
  updatedAt: number;
  costNanoUsd: number;
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
    LastEventOccurredAt: occurredAtMs,
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

describe.skipIf(!enabled)("the gateway figures of the usage report (real ClickHouse)", () => {
  const tenants = { install: `usage-gateway-${run}`, empty: `usage-gateway-empty-${run}` };
  const recentMs = now - 3 * DAY_MS;
  const oldMs = now - 40 * DAY_MS;

  beforeAll(async () => {
    ({ client } = await startMigratedGatewayClickHouse());
    repo = new ClickHouseGatewaySpendEventsRepository(async () => client);
    // Both versions of the settled request stay on disk until the query has read them.
    await client.command({ query: "SYSTEM STOP MERGES gateway_spend" });
    const requestId = `req-settled-${run}`;
    await fold({
      tenantId: tenants.install,
      requestId,
      at: state({
        status: "admitted",
        occurredAtMs: recentMs,
        updatedAt: recentMs,
        costNanoUsd: NANO_PER_USD,
      }),
    });
    await fold({
      tenantId: tenants.install,
      requestId,
      at: state({
        status: "confirmed",
        occurredAtMs: recentMs,
        updatedAt: recentMs + 1_000,
        costNanoUsd: 3 * NANO_PER_USD,
      }),
    });
    await fold({
      tenantId: tenants.install,
      requestId: `req-old-${run}`,
      at: state({
        status: "confirmed",
        occurredAtMs: oldMs,
        updatedAt: oldMs,
        costNanoUsd: 2 * NANO_PER_USD,
      }),
    });
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({ query: "SYSTEM START MERGES gateway_spend" });
    await client.command({
      query: "ALTER TABLE gateway_spend DELETE WHERE TenantId IN ({a:String}, {b:String})",
      query_params: { a: tenants.install, b: tenants.empty },
    });
  }, 120_000);

  describe("given a gateway request admitted at one price and settled at another, and one from forty days ago", () => {
    describe("when gateway requests and spend are read", () => {
      /** @scenario Gateway requests and spend come from the spend ledger */
      it("counts the settled request once at its settled cost, and dates the first from the oldest row", async () => {
        const projectIds = [tenants.install];

        const lifetime = await repo.countUsage({ projectIds });
        const sevenDays = await repo.countUsage({ projectIds, since: now - 7 * DAY_MS });
        const twentyEightDays = await repo.countUsage({ projectIds, since: now - 28 * DAY_MS });

        expect(lifetime).toMatchObject({ requests: 2, spendUsd: 5, firstRequestAt: oldMs });
        expect(sevenDays).toMatchObject({ requests: 1, spendUsd: 3, firstRequestAt: oldMs });
        expect(twentyEightDays).toMatchObject({ requests: 1, spendUsd: 3 });
      });
    });
  });

  describe("given an install that never sent a gateway request", () => {
    describe("when the first request is read", () => {
      /** @scenario The ladder gains the first gateway request, Instant Eval run and coding agent session */
      it("dates the rung from the oldest row where there is one, and leaves it out where none", async () => {
        const reached = await repo.countUsage({ projectIds: [tenants.install] });
        const never = await repo.countUsage({ projectIds: [tenants.empty] });

        expect(reached.firstRequestAt).toBe(oldMs);
        expect(never).toEqual({ requests: 0, spendUsd: 0 });
      });
    });
  });
});
