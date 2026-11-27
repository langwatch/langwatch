/** @vitest-environment node */

/**
 * Usage langevals reported for a call on stored provider credentials, recorded through the
 * internal protocol: the spend record holds one row per request, and the debit writer charges
 * the organization budget the call falls under (ADR-193).
 * @see modules/gateway/specs/gateway-platform-provider-usage.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import {
  buildProcessDefinition,
  buildProcessManager,
  createTenantId,
  type JsonValue,
} from "@langwatch/eventing";
import {
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  type GatewayProviderUsageResult,
  type GatewayResolvedBudget,
} from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type WriteGatewayDebitsPayload,
  writeGatewayDebitsSchema,
} from "../../../eventing/gateway-debit.intent.ts";
import {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
} from "../../../eventing/gateway-debit.process.ts";
import { confirmSpendCommandDataSchema } from "../../../eventing/gateway-spend-commands.process.ts";
import { ConfirmSpendCommand } from "../../../eventing/gateway-spend.intent.ts";
import { GatewaySpendStore } from "../../../eventing/gateway-spend.pipeline.ts";
import { GatewaySpendFoldProjection } from "../../../eventing/gateway-spend.projection.ts";
import { GatewayBudgetChangeDedupeService } from "../../../features/budget/services/gateway-budget-change-dedupe.service.ts";
import { GatewayBudgetCrossingService } from "../../../features/budget/services/gateway-budget-crossing.service.ts";
import { GatewaySpendDebitService } from "../../../features/spend/services/gateway-spend-debit.service.ts";
import {
  GatewayInternalProtocolService,
  type GatewayInternalProtocolMembers,
} from "../../../services/gateway-internal-protocol.service.ts";
import type { BucketBoundaryRow } from "../../gateway-budget.repository.ts";
import type { AppendGatewayChangeEventInput } from "../../gateway-change-event.repository.ts";
import { GatewayBudgetClickHouseRepository } from "../clickhouse.gateway-budget.repository.ts";
import { ClickHouseGatewaySpendEventsRepository } from "../clickhouse.gateway-spend-events.repository.ts";
import { gatewayClickHouseOver } from "./support/clickhouse-endpoint.support.ts";
import { startMigratedGatewayClickHouse } from "./support/migrated-clickhouse.harness.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const TENANT = `platform-usage-${run}`;
const ORGANIZATION = `org-platform-${run}`;
const PROVIDER_ROW = `mp-openai-${run}`;
const COST_NANO_USD = 156_000_000;
const REQUEST_ID = `topic_clustering:run:run-${run}:page-0:openai/text-embedding-3-large`;
const SEARCH_REQUEST_ID = `evaluation:${run}:openai/gpt-5-search`;

/** An organization-wide monthly budget on the stored OpenAI row. */
function organizationBudget(): GatewayResolvedBudget {
  const at = nowInstant();
  return {
    budget: {
      id: `bdg-org-${run}`,
      organizationId: ORGANIZATION,
      scopeType: "ORGANIZATION",
      scopeId: ORGANIZATION,
      providerKey: PROVIDER_ROW,
      name: "organization openai",
      description: null,
      window: "MONTH",
      limitUsd: { toString: () => "100", toFixed: () => "100" },
      onBreach: "WARN",
      timezone: null,
      externalId: null,
      metadata: null,
      spentUsd: { toString: () => "0", toFixed: () => "0" },
      currentPeriodStartedAt: at,
      resetsAt: at,
      lastResetAt: null,
      cycleAnchorAt: null,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
      createdById: `usr-${run}`,
      managedByVirtualKeyId: null,
    },
    bucketScopeId: ORGANIZATION,
    principalUserId: null,
    groupId: null,
    endUserId: null,
  };
}

let client: ClickHouseClient;
let store: GatewaySpendStore;
let debits: GatewaySpendDebitService;
let protocol: GatewayInternalProtocolService;
const debitDefinition = buildProcessDefinition(
  buildProcessManager({
    name: GATEWAY_DEBITS_PROCESS_NAME,
    applier: GatewayDebitProcess.create({
      debits: { write: (payload) => debits.write(payload) },
    }).processManager(),
  }).config,
);

/** The confirm command's event, folded into the spend record and joined into its debit. */
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

  const evolved = debitDefinition.evolve({
    previousState: debitDefinition.initialState,
    ref: {
      processName: GATEWAY_DEBITS_PROCESS_NAME,
      projectId: TENANT,
      processKey: data.gateway_request_id,
    },
    input: {
      kind: "event",
      now: Date.now(),
      event: {
        eventId: event.id,
        eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        occurredAt: data.occurred_at,
        tenantId: TENANT,
        projectId: TENANT,
        processKey: data.gateway_request_id,
        payload: serialised(data),
      },
    },
  });
  for (const intent of evolved.intents) {
    await debits.write(writeGatewayDebitsSchema.parse(intent.payload) as WriteGatewayDebitsPayload);
  }
}

/** The confirm data as the process inbox stores it: through JSON. */
function serialised(value: unknown): JsonValue {
  const json: JsonValue = JSON.parse(JSON.stringify(value));
  return json;
}

function suppliedMembers(
  members: Partial<GatewayInternalProtocolMembers>,
): GatewayInternalProtocolMembers {
  return new Proxy(members as GatewayInternalProtocolMembers, {
    get(target, property) {
      if (property in target) return Reflect.get(target, property);
      throw new Error(`recordProviderUsage reached "${String(property)}", not supplied`);
    },
  });
}

async function rows<Row>(query: string, requestId: string): Promise<Row[]> {
  const result = await client.query({
    query,
    query_params: { tenantId: TENANT, requestId },
    format: "JSONEachRow",
  });
  return result.json<Row>();
}

describe.skipIf(!enabled)("platform provider usage on the ledger (real ClickHouse)", () => {
  beforeAll(async () => {
    ({ client } = await startMigratedGatewayClickHouse());
    const resolver = gatewayClickHouseOver(client);
    store = GatewaySpendStore.create(new ClickHouseGatewaySpendEventsRepository(resolver));
    const budgets = new GatewayBudgetClickHouseRepository(resolver);
    debits = GatewaySpendDebitService.create({
      budgets: { resolveApplicableBudgets: async () => [organizationBudget()] },
      spend: budgets,
      dedupe: GatewayBudgetChangeDedupeService.create(null),
      changes: { append: async (_input: AppendGatewayChangeEventInput) => ({ revision: 1n }) },
      crossings: GatewayBudgetCrossingService.create({
        budgets: {
          listSpendTenantIds: async () => [TENANT],
          findBucketBoundaries: async (): Promise<BucketBoundaryRow[]> => [],
        },
        spend: budgets,
        facts: { recordBudgetCrossing: async () => {} },
      }),
    });
    protocol = GatewayInternalProtocolService.create(
      suppliedMembers({
        spend: {
          commands: { confirmSpend: { send: confirmThroughTheSpine } },
          rating: { rate: () => ({ costNanoUsd: COST_NANO_USD, rateVersion: "registry@test" }) },
        },
        projects: createApiFixture<ProjectApi>({
          findWithTeam: async () =>
            ({ id: TENANT, team: { id: `team-${run}`, organizationId: ORGANIZATION } }) as Awaited<
              ReturnType<ProjectApi["findWithTeam"]>
            >,
        }),
      }),
    );
  }, 120_000);

  afterAll(async () => {
    if (!client) return;
    for (const table of ["gateway_spend", "gateway_budget_ledger_events"]) {
      await client.command({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: TENANT },
      });
    }
  }, 120_000);

  describe("given topic clustering embeddings that langevals reported, then reported again on a retry", () => {
    const results: GatewayProviderUsageResult[] = [];

    beforeAll(async () => {
      const usage = {
        requestId: REQUEST_ID,
        projectId: TENANT,
        model: "openai/text-embedding-3-large",
        modelProviderId: PROVIDER_ROW,
        requestType: "topic_clustering",
        usage: { input_tokens: 1_200_000 },
        durationMs: 900,
        occurredAt: Date.now(),
      };
      results.push(await protocol.recordProviderUsage(usage));
      results.push(await protocol.recordProviderUsage(usage));
    }, 120_000);

    /** @scenario A platform call on stored provider credentials lands on the ledger and debits its budgets */
    it("holds one confirmed spend row under the project, organization and provider row", async () => {
      expect(results).toEqual([{ status: "recorded" }, { status: "recorded" }]);
      const spend = await rows<{
        Status: string;
        RequestType: string;
        OrganizationId: string;
        VirtualKeyId: string;
        ProviderKey: string;
        TokensInput: number | string;
        CostNanoUSD: number | string;
      }>(
        `SELECT Status, RequestType, OrganizationId, VirtualKeyId, ProviderKey, TokensInput, CostNanoUSD
         FROM gateway_spend FINAL
         WHERE TenantId = {tenantId:String} AND GatewayRequestId = {requestId:String}`,
        REQUEST_ID,
      );

      expect(spend).toHaveLength(1);
      expect(spend[0]).toMatchObject({
        Status: "confirmed",
        RequestType: "topic_clustering",
        OrganizationId: ORGANIZATION,
        VirtualKeyId: "",
        ProviderKey: PROVIDER_ROW,
      });
      expect(Number(spend[0]?.TokensInput)).toBe(1_200_000);
      expect(Number(spend[0]?.CostNanoUSD)).toBe(COST_NANO_USD);
    });

    /** @scenario A retried topic clustering page reports its provider usage under the same request id */
    it("debits the organization budget once, at the rated cost", async () => {
      const debited = await rows<{
        BudgetId: string;
        Scope: string;
        ScopeId: string;
        Cost: string;
      }>(
        `SELECT BudgetId, Scope, ScopeId, toString(AmountNanoUSD) AS Cost
         FROM gateway_budget_ledger_events
         WHERE TenantId = {tenantId:String} AND GatewayRequestId = {requestId:String}`,
        REQUEST_ID,
      );

      expect(debited).toEqual([
        {
          BudgetId: `bdg-org-${run}`,
          Scope: "org",
          ScopeId: ORGANIZATION,
          Cost: String(COST_NANO_USD),
        },
      ]);
    });
  });

  describe("given an evaluator call that ran web searches", () => {
    beforeAll(async () => {
      await protocol.recordProviderUsage({
        requestId: SEARCH_REQUEST_ID,
        projectId: TENANT,
        model: "openai/gpt-5-search",
        modelProviderId: PROVIDER_ROW,
        requestType: "evaluation",
        usage: { input_tokens: 400, output_tokens: 80, web_search_requests: 3 },
        durationMs: 1_200,
        occurredAt: Date.now(),
      });
    }, 120_000);

    it("stores the search count on the spend row and folds it back", async () => {
      const spend = await rows<{ WebSearchRequests: number | string }>(
        `SELECT WebSearchRequests
         FROM gateway_spend FINAL
         WHERE TenantId = {tenantId:String} AND GatewayRequestId = {requestId:String}`,
        SEARCH_REQUEST_ID,
      );
      expect(spend.map((row) => Number(row.WebSearchRequests))).toEqual([3]);

      const context = { aggregateId: SEARCH_REQUEST_ID, tenantId: createTenantId(TENANT) };
      const read = await store.get(SEARCH_REQUEST_ID, context);
      expect(read.kind === "folded" && read.state.usage?.web_search_requests).toBe(3);
    });
  });
});
