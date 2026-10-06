/** @vitest-environment node */

/**
 * A judged run or query's priced outcome, appended through the internal protocol and folded into
 * the spend record: the row the ledger holds is the row the customer is charged on.
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createTenantId } from "@langwatch/eventing";
import type { GatewayPricedSpend } from "@langwatch/gateway-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { confirmSpendCommandDataSchema } from "../../../eventing/gateway-spend-commands.process.ts";
import { ConfirmSpendCommand } from "../../../eventing/gateway-spend.intent.ts";
import { GatewaySpendStore } from "../../../eventing/gateway-spend.pipeline.ts";
import { GatewaySpendFoldProjection } from "../../../eventing/gateway-spend.projection.ts";
import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
} from "../../../services/gateway-internal-protocol.service.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";
import { startMigratedGatewayClickHouse } from "./support/migrated-clickhouse.harness.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const TENANT = `instant-eval-ledger-${run}`;
const OCCURRED_AT = Date.UTC(2026, 8, 22, 10, 0, 0);
const INPUT_TOKENS = 12_000;
const CUSTOMER_PRICE_NANO_USD = 13_000_000;

let client: ClickHouseClient;
let store: GatewaySpendStore;
let protocol: GatewayInternalProtocolService;

/** The ledger's own confirm path: the command's event, folded and stored as the pipeline does. */
async function confirmThroughTheSpine(payload: unknown): Promise<void> {
  const data = confirmSpendCommandDataSchema.parse(payload);
  const [event] = await new ConfirmSpendCommand().handle({
    tenantId: createTenantId(data.tenantId),
    data,
  } as Parameters<ConfirmSpendCommand["handle"]>[0]);
  if (!event) throw new Error("the confirm command produced no event");

  const projection = GatewaySpendFoldProjection.create({ store });
  const context = { aggregateId: event.aggregateId, tenantId: event.tenantId };
  const read = await store.get(event.aggregateId, context);
  const state = projection.apply(read.kind === "folded" ? read.state : projection.init(), event);
  await store.store(state, context);
}

/** Only what this suite named; anything else refuses by name. */
function suppliedMembers(
  members: Partial<GatewayInternalProtocolMembers>,
): GatewayInternalProtocolMembers {
  return new Proxy(members as GatewayInternalProtocolMembers, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);

      throw new Error(
        `recordPricedSpend reached "${String(property)}", which this suite did not supply`,
      );
    },
  });
}

function pricedSpend({
  requestId,
  runId,
}: {
  requestId: string;
  runId?: string;
}): GatewayPricedSpend {
  return {
    requestId,
    projectId: TENANT,
    organizationId: `org-${run}`,
    teamId: `team-${run}`,
    requestType: "instant_eval",
    model: "jev",
    rateVersion: "instant_eval@0.8x1.3",
    inputTokens: INPUT_TOKENS,
    costNanoUsd: CUSTOMER_PRICE_NANO_USD,
    metadata: JSON.stringify({
      instant_eval: { cost_usd: 0.01, requests: 40, ...(runId ? { run_id: runId } : {}) },
    }),
    occurredAt: OCCURRED_AT,
  };
}

async function ledgerRowsFor(requestId: string) {
  const result = await client.query({
    query: `
      SELECT Status, RequestType, Model, OrganizationId, TokensInput, CostNanoUSD, Metadata
      FROM gateway_spend FINAL
      WHERE TenantId = {tenantId:String} AND GatewayRequestId = {requestId:String}`,
    query_params: { tenantId: TENANT, requestId },
    format: "JSONEachRow",
  });
  return result.json<{
    Status: string;
    RequestType: string;
    Model: string;
    OrganizationId: string;
    TokensInput: number | string;
    CostNanoUSD: number | string;
    Metadata: string;
  }>();
}

describe.skipIf(!enabled)("the spend record of an Instant Eval outcome (real ClickHouse)", () => {
  beforeAll(async () => {
    ({ client } = await startMigratedGatewayClickHouse());
    store = GatewaySpendStore.create(
      new ClickHouseGatewaySpendEventsRepository(async () => client),
    );
    protocol = GatewayInternalProtocolService.create(
      suppliedMembers({
        spend: {
          commands: { confirmSpend: { send: confirmThroughTheSpine } },
          rating: {
            rate: () => {
              throw new Error("a self-priced outcome must not be re-rated");
            },
          },
        },
      }),
    );
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({
      query: "ALTER TABLE gateway_spend DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: TENANT },
    });
  }, 120_000);

  describe("given a run that judged input tokens", () => {
    /** @scenario A finished run lands one row on the spend ledger with the right amounts */
    it("holds one confirmed row for the run, at the customer price and the run's tokens", async () => {
      const requestId = `instanteval_run-${run}`;

      const result = await protocol.recordPricedSpend(
        pricedSpend({ requestId, runId: `run-${run}` }),
      );

      expect(result).toEqual({ status: "recorded" });
      const rows = await ledgerRowsFor(requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        Status: "confirmed",
        RequestType: "instant_eval",
        Model: "jev",
        OrganizationId: `org-${run}`,
      });
      expect(Number(rows[0]?.CostNanoUSD)).toBe(CUSTOMER_PRICE_NANO_USD);
      expect(Number(rows[0]?.TokensInput)).toBe(INPUT_TOKENS);
      expect(JSON.parse(rows[0]?.Metadata ?? "{}").instant_eval.run_id).toBe(`run-${run}`);
    });
  });

  describe("given a synchronous query that judged input tokens", () => {
    /** @scenario A synchronous query lands one row on the spend ledger */
    it("holds one confirmed row of request type instant_eval under the query's own id", async () => {
      const requestId = `instantevalquery_${run}`;

      await protocol.recordPricedSpend(pricedSpend({ requestId }));

      const rows = await ledgerRowsFor(requestId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ Status: "confirmed", RequestType: "instant_eval" });
      expect(JSON.parse(rows[0]?.Metadata ?? "{}").instant_eval).not.toHaveProperty("run_id");
    });
  });
});
