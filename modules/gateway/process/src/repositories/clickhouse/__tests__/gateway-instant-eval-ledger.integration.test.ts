/** @vitest-environment node */

/**
 * A judged run or query's priced outcome, appended through the internal protocol and folded into
 * the spend record: the row the ledger holds is the row the customer is charged on.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createTenantId } from "@langwatch/eventing";
import type { GatewayPricedSpend } from "@langwatch/gateway-contract";
import {
  INSTANT_EVAL_REQUEST_TYPE,
  InstantEvalFreeBudgetExhaustedError,
  type InstantEvalJudgeSpendPricedEventData,
} from "@langwatch/instant-eval-judge-contract";
import { instantEvalRunStartBudgetOver } from "@langwatch/instant-eval-process/testing";
import type { ProjectWithTeam } from "@langwatch/project-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { confirmSpendCommandDataSchema } from "../../../eventing/gateway-spend-commands.process.ts";
import { ConfirmSpendCommand } from "../../../eventing/gateway-spend.intent.ts";
import { GatewaySpendStore } from "../../../eventing/gateway-spend.pipeline.ts";
import { GatewaySpendFoldProjection } from "../../../eventing/gateway-spend.projection.ts";
import { GatewayInstantEvalJudgeSpendService } from "../../../services/gateway-instant-eval-judge-spend.service.ts";
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
let ledger: ClickHouseGatewaySpendEventsRepository;

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
  virtualKeyId,
}: {
  requestId: string;
  runId?: string;
  virtualKeyId?: string;
}): GatewayPricedSpend {
  return {
    requestId,
    projectId: TENANT,
    organizationId: `org-${run}`,
    teamId: `team-${run}`,
    ...(virtualKeyId ? { virtualKeyId } : {}),
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
      SELECT Status, RequestType, Model, OrganizationId, VirtualKeyId, TokensInput, CostNanoUSD, Metadata
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
    VirtualKeyId: string;
    TokensInput: number | string;
    CostNanoUSD: number | string;
    Metadata: string;
  }>();
}

describe.skipIf(!enabled)("the spend record of an Instant Eval outcome (real ClickHouse)", () => {
  beforeAll(async () => {
    ({ client } = await startMigratedGatewayClickHouse());
    ledger = new ClickHouseGatewaySpendEventsRepository(async () => client);
    store = GatewaySpendStore.create(ledger);
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

  describe("given a call forwarded under a license's managed key", () => {
    /** @scenario Forwarded calls are metered under the customer organization */
    it("holds the row under the customer organization and the managed key", async () => {
      const requestId = `forwarded-${run}`;
      const managedKey = `vk-managed-${run}`;

      await protocol.recordPricedSpend({
        ...pricedSpend({ requestId, virtualKeyId: managedKey }),
        requestType: "chat",
        model: "gpt-5-mini",
      });

      const [row] = await ledgerRowsFor(requestId);
      expect(row).toMatchObject({
        Status: "confirmed",
        RequestType: "chat",
        OrganizationId: `org-${run}`,
        VirtualKeyId: managedKey,
      });
    });

    /** @scenario A classify call is judged and metered under the customer organization */
    it("holds an Instant Eval row of request type instant_eval under the same key", async () => {
      const requestId = `instanteval-hosted-${run}`;
      const managedKey = `vk-managed-${run}`;

      await protocol.recordPricedSpend(pricedSpend({ requestId, virtualKeyId: managedKey }));

      const [row] = await ledgerRowsFor(requestId);
      expect(row).toMatchObject({
        RequestType: "instant_eval",
        OrganizationId: `org-${run}`,
        VirtualKeyId: managedKey,
      });
      expect(Number(row?.CostNanoUSD)).toBe(CUSTOMER_PRICE_NANO_USD);
    });
  });

  describe("given a free organization whose judge calls were priced at $1.00 in total", () => {
    const organizationId = `org-judge-${run}`;
    const judgedProject = `${TENANT}-judged`;

    /** The judge's priced fact for one call, as the leaf appends it. */
    function judgeFact({
      requestId,
      priceNanoUsd,
    }: {
      requestId: string;
      priceNanoUsd: number;
    }): InstantEvalJudgeSpendPricedEventData {
      return {
        tenantId: organizationId,
        occurredAt: OCCURRED_AT,
        organizationId,
        projectId: judgedProject,
        requestId,
        model: "langwatch/instant-evals",
        rateVersion: "instant_eval@0.8x1.3",
        inputTokens: 900,
        priceNanoUsd,
        costNanoUsd: Math.round(priceNanoUsd / 1.3),
      };
    }

    afterAll(async () => {
      if (!client) return;
      await client.command({
        query: "ALTER TABLE gateway_spend DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: judgedProject },
      });
    }, 120_000);

    /** @scenario Judge spend in the ledger counts against a run */
    it("holds one row per judge call, however often its fact arrives, and refuses the run", async () => {
      const spend = GatewayInstantEvalJudgeSpendService.create({
        projects: {
          findWithTeam: async (projectId) =>
            projectId === judgedProject
              ? ({ id: projectId, team: { id: `team-${run}`, organizationId } } as ProjectWithTeam)
              : null,
        },
        recordPricedSpend: (input) => protocol.recordPricedSpend(input),
      });
      const first = judgeFact({
        requestId: `instantevaljudge_a-${run}`,
        priceNanoUsd: 600_000_000,
      });
      const second = judgeFact({
        requestId: `instantevaljudge_b-${run}`,
        priceNanoUsd: 400_000_000,
      });

      // The first call's fact is delivered twice, as a redelivery would.
      await spend.recordJudgeSpend({ fact: first });
      await spend.recordJudgeSpend({ fact: first });
      await spend.recordJudgeSpend({ fact: second });

      const rows = async (requestId: string) =>
        (
          await client.query({
            query: `
              SELECT RequestType, OrganizationId, CostNanoUSD
              FROM gateway_spend FINAL
              WHERE TenantId = {tenantId:String} AND GatewayRequestId = {requestId:String}`,
            query_params: { tenantId: judgedProject, requestId },
            format: "JSONEachRow",
          })
        ).json<{ RequestType: string; OrganizationId: string; CostNanoUSD: number | string }>();
      const firstRows = await rows(first.requestId);
      expect(firstRows).toHaveLength(1);
      expect(firstRows[0]).toMatchObject({
        RequestType: INSTANT_EVAL_REQUEST_TYPE,
        OrganizationId: organizationId,
      });
      expect(Number(firstRows[0]?.CostNanoUSD)).toBe(600_000_000);
      expect(await rows(second.requestId)).toHaveLength(1);

      const budget = instantEvalRunStartBudgetOver({
        peers: {
          findOrganizationId: async () => organizationId,
          listProjectIds: async () => [judgedProject],
          isFreePlan: async () => true,
          sumSpendNanoUsdByRequestType: ({ tenantIds, requestType }) =>
            ledger.sumCostNanoUsdByRequestType({ tenantIds: [...tenantIds], requestType }),
        },
      });
      await expect(budget.assertWithinBudget({ projectId: judgedProject })).rejects.toBeInstanceOf(
        InstantEvalFreeBudgetExhaustedError,
      );
    });
  });
});
