import {
  GatewayDebitProcess,
  GATEWAY_DEBITS_PROCESS_NAME,
} from "@langwatch/enterprise-governance-server";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type WebhookDeliveryProcessDeps,
  webhookDeliveryPM,
} from "~/runtime/app/features/webhooks";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
} from "@langwatch/eventing";
import {
  AdmitSpendCommand,
  ConfirmSpendCommand,
  FailSpendCommand,
  SettleSpendCommand,
} from "./commands/spendCommands";
import {
  SPEND_SETTLEMENT_PROCESS_NAME,
  type SpendSettlementProcessDeps,
  spendSettlementPM,
} from "./process-manager/spendSettlement.process";
import {
  createGatewaySpendFoldProjection,
  type GatewaySpendState,
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_PIPELINE_NAME,
  GATEWAY_SPEND_PROCESSING_EVENT_TYPES,
  type GatewaySpendProcessingEvent,
} from "@langwatch/gateway-server";

export interface GatewaySpendProcessingPipelineDeps {
  gatewaySpendStore: FoldProjectionStore<GatewaySpendState>;
  /** The ADR-073 delivery process manager; absent when webhooks are off
   *  (the pipeline still projects, delivery just has no consumer). */
  webhookDelivery?: WebhookDeliveryProcessDeps;
  /** The gateway's budget debits; absent without the ClickHouse spend path
   *  (the ledger is the only spend store). */
  gatewayDebits?: GatewayDebitProcess;
  /** The M2 settlement sweeper: settles admissions whose confirmation
   *  never arrived inside the grace window. */
  settlement?: SpendSettlementProcessDeps;
}

/**
 * The gateway spend pipeline (spend-command spine).
 *
 * Aggregate: `gateway_request`, one aggregate per gateway REQUEST, id is
 * the gateway's own ULID, minted before the provider is dispatched. The
 * Go gateway emits the commands asynchronously through its bounded local
 * spool (never a synchronous networked write on the request path, never a
 * refused request for recordability); the internal ingest route validates
 * batches and appends here.
 *
 * Write surface:
 * - admitSpend:   attribution + end user + metadata, before any outcome
 * - confirmSpend: usage quantities + rate identity after the provider
 * - failSpend:    the full error taxonomy, partial usage
 * - settleSpend:  the settlement process manager (M2) resolves admissions
 *                 whose confirmation never arrived, visibly
 *
 * Projection: gatewaySpend (fold) → `gateway_spend`, one row per request,
 * rated in the fold to integer nano-USD. Consumption is projections + (in
 * M2) a process manager, no subscribers, per the post-event-work ADR line.
 */
export function createGatewaySpendProcessingPipeline(
  deps: GatewaySpendProcessingPipelineDeps,
) {
  let pipeline = definePipeline<GatewaySpendProcessingEvent>({
    name: GATEWAY_SPEND_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: GATEWAY_SPEND_AGGREGATE_TYPE,
      events: defineEvents(GATEWAY_SPEND_PROCESSING_EVENT_TYPES),
    }),
  })
    .withClickHouseFoldProjection(
      createGatewaySpendFoldProjection(deps.gatewaySpendStore),
    )
    .withCommand("admitSpend", AdmitSpendCommand)
    .withCommand("confirmSpend", ConfirmSpendCommand)
    .withCommand("failSpend", FailSpendCommand)
    .withCommand("settleSpend", SettleSpendCommand);
  if (deps.webhookDelivery) {
    pipeline = pipeline.withProcessManager(
      WEBHOOK_DELIVERY_PROCESS_NAME,
      webhookDeliveryPM(deps.webhookDelivery),
    );
  }
  if (deps.gatewayDebits) {
    pipeline = pipeline.withProcessManager(
      GATEWAY_DEBITS_PROCESS_NAME,
      deps.gatewayDebits.processManager(),
    );
  }
  if (deps.settlement) {
    pipeline = pipeline.withProcessManager(
      SPEND_SETTLEMENT_PROCESS_NAME,
      spendSettlementPM(deps.settlement),
    );
  }
  return pipeline.build();
}
