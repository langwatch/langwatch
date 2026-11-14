/**
 * Gateway's budget ledger debits each cost a governance push source recorded, from its own side
 * and in the worker (§9; as for pulled usage, Q208C), so no request writes a gateway-owned row.
 * Spec: specs/ai-gateway/governance/ingested-cost-ledger.feature
 */
import {
  INGESTED_COST_EVENT_TYPES,
  ingestedCostRecordedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GatewayModule } from "../app/gateway.app.ts";
import type { GatewaySpendDebitService } from "../features/spend/services/gateway-spend-debit.service.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";

const GATEWAY_INGESTED_COST_LEDGER_PIPELINE_NAME = "gateway_ingested_cost_ledger" as const;

export type GatewayIngestedCostLedgerPipeline = StaticPipelineDefinition<never>;

/** No ledger (no ClickHouse) registers no subscriber: there is nowhere for the debit to land. */
export function buildGatewayIngestedCostLedgerPipeline({
  debits,
}: {
  debits: Pick<GatewaySpendDebitService, "writeIngestedCost"> | undefined;
}): GatewayIngestedCostLedgerPipeline {
  const pipeline = definePipeline({
    name: GATEWAY_INGESTED_COST_LEDGER_PIPELINE_NAME,
    // `global`: gateway appends no events here; it only debits governance's.
    aggregate: defineAggregate({ type: "global" }),
  }).withEvents([]);
  if (debits) {
    // A failed write rethrows for the queue's retry; the ledger skips a request it already holds.
    pipeline.withPeerSubscriber("gatewayIngestedCostDebit", {
      eventType: INGESTED_COST_EVENT_TYPES.RECORDED,
      data: ingestedCostRecordedEventDataSchema,
      handle: (fact, { tenantId }) => debits.writeIngestedCost({ tenantId, fact }),
    });
  }
  return pipeline.build();
}

export const gatewayIngestedCostLedgerEventing = defineEventingModule({
  pipeline: GATEWAY_INGESTED_COST_LEDGER_PIPELINE_NAME,
  build: ({ app }: EventingSetup<GatewayRepositories, GatewayModule>) =>
    app.ingestedCostLedgerPipeline(),
});
