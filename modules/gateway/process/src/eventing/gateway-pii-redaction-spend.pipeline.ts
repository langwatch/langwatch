/**
 * Gateway writes the ledger row for each PII redaction model call from data-privacy's priced fact
 * (ADR-201); data-privacy calls no gateway Api; the request id keeps a repeat to one row.
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import {
  PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
  piiRedactionSpendPricedEventDataSchema,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GatewayModule } from "../app/gateway.app.ts";
import type { GatewayPiiRedactionSpendService } from "../features/spend/services/gateway-pii-redaction-spend.service.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";

const GATEWAY_PII_REDACTION_SPEND_PIPELINE_NAME = "gateway_pii_redaction_spend" as const;

export type GatewayPiiRedactionSpendPipeline = StaticPipelineDefinition<never>;

export function buildGatewayPiiRedactionSpendPipeline({
  spend,
}: {
  spend: Pick<GatewayPiiRedactionSpendService, "recordPiiRedactionSpend">;
}): GatewayPiiRedactionSpendPipeline {
  return (
    definePipeline({
      name: GATEWAY_PII_REDACTION_SPEND_PIPELINE_NAME,
      // `global`: gateway appends no events here; it only writes data-privacy's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // The spine keys a confirm by project and request, so a redelivery writes one row.
      .withPeerSubscriber("gatewayPiiRedactionSpendRow", {
        eventType: PII_REDACTION_SPEND_PRICED_EVENT_TYPE,
        data: piiRedactionSpendPricedEventDataSchema,
        handle: (fact) => spend.recordPiiRedactionSpend({ fact }),
      })
      .build()
  );
}

export const gatewayPiiRedactionSpendEventing = defineEventingModule({
  pipeline: GATEWAY_PII_REDACTION_SPEND_PIPELINE_NAME,
  build: ({ app }: EventingSetup<GatewayRepositories, GatewayModule>) =>
    app.piiRedactionSpendPipeline(),
});
