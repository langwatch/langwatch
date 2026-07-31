import {
  ATTRIBUTED_DEBITS_PROCESS_NAME,
  type AttributedDebitsProcessDeps,
  attributedUserDebitsPM,
} from "@ee/governance/process-manager/attributedUserDebits.process";
import {
  WEBHOOK_DELIVERY_PROCESS_NAME,
  type WebhookDeliveryProcessDeps,
  webhookDeliveryPM,
} from "@ee/webhooks/process-manager/webhookDelivery.process";
import { definePipeline } from "../..";
import type { FoldProjectionStore } from "../../projections/foldProjection.types";
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
  GatewaySpendFoldProjection,
  type GatewaySpendState,
} from "./projections/gatewaySpend.foldProjection";
import {
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_PIPELINE_NAME,
} from "./schemas/constants";
import type { GatewaySpendProcessingEvent } from "./schemas/events";

export interface GatewaySpendProcessingPipelineDeps {
  gatewaySpendStore: FoldProjectionStore<GatewaySpendState>;
  /** The ADR-073 delivery process manager; absent when webhooks are off
   *  (the pipeline still projects, delivery just has no consumer). */
  webhookDelivery?: WebhookDeliveryProcessDeps;
  /** Attributed-user budget debits; absent without the ClickHouse spend
   *  path (per-user buckets cannot exist without the ledger). */
  attributedDebits?: AttributedDebitsProcessDeps;
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
 * M2) a process manager, no reactors, per the post-event-work ADR line.
 */
export function createGatewaySpendProcessingPipeline(
  deps: GatewaySpendProcessingPipelineDeps,
) {
  let pipeline = definePipeline<GatewaySpendProcessingEvent>()
    .withName(GATEWAY_SPEND_PIPELINE_NAME)
    .withAggregateType(GATEWAY_SPEND_AGGREGATE_TYPE)
    .withFoldProjection(
      "gatewaySpend",
      new GatewaySpendFoldProjection({ store: deps.gatewaySpendStore }),
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
  if (deps.attributedDebits) {
    pipeline = pipeline.withProcessManager(
      ATTRIBUTED_DEBITS_PROCESS_NAME,
      attributedUserDebitsPM(deps.attributedDebits),
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
