/**
 * Gateway's budget ledger debits governance's priced pulled-usage fact from its own side
 * (§9; Q208C, Alex 2026-10-06), so governance writes no gateway-owned row and needs no Api edge.
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 */
import {
  PULLED_USAGE_EVENT_TYPES,
  pulledUsagePricedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GatewayModule } from "../app/gateway.app.ts";
import type { GatewayBudgetLedgerService } from "../features/budget/services/gateway-budget-ledger.service.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";

const GATEWAY_PULLED_USAGE_LEDGER_PIPELINE_NAME = "gateway_pulled_usage_ledger" as const;

export type GatewayPulledUsageLedgerPipeline = StaticPipelineDefinition<never>;

/** No ledger (no ClickHouse) registers no subscriber, as main composed no ledger process. */
export function buildGatewayPulledUsageLedgerPipeline({
  ledger,
}: {
  ledger: Pick<GatewayBudgetLedgerService, "debitPulledUsage"> | undefined;
}): GatewayPulledUsageLedgerPipeline {
  const pipeline = definePipeline({
    name: GATEWAY_PULLED_USAGE_LEDGER_PIPELINE_NAME,
    // `global`: gateway appends no events here; it only debits governance's.
    aggregate: defineAggregate({ type: "global" }),
  }).withEvents([]);
  if (ledger) {
    // The ledger skips a row it already holds unchanged, so a redelivery debits nothing twice.
    pipeline.withPeerSubscriber("gatewayPulledUsageDebit", {
      eventType: PULLED_USAGE_EVENT_TYPES.PRICED,
      data: pulledUsagePricedEventDataSchema,
      handle: (fact, { tenantId }) => ledger.debitPulledUsage({ tenantId, fact }),
    });
  }
  return pipeline.build();
}

export const gatewayPulledUsageLedgerEventing = defineEventingModule({
  pipeline: GATEWAY_PULLED_USAGE_LEDGER_PIPELINE_NAME,
  build: ({ app }: EventingSetup<GatewayRepositories, GatewayModule>) =>
    app.pulledUsageLedgerPipeline(),
});
