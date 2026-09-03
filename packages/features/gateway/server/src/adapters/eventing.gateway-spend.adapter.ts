import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type FoldProjectionStore,
  type ProcessManagerApplier,
} from "@langwatch/eventing";
import type { SettleSpendCommandData } from "../processes/gateway-spend-commands.process";
import type { SpendSettlementProcessDeps } from "../intents/gateway-spend-settlement.intent";
import {
  SPEND_SETTLEMENT_PROCESS_NAME,
  spendSettlementPM,
} from "../processes/gateway-spend-settlement.process";
import type { GatewaySpendState } from "../projections/gateway-spend.projection";
import type { GatewaySpendEventsPort } from "../ports/gateway-spend-events.port";
import { GatewaySpendStore } from "../stores/gateway-spend/gateway-spend.store";
import {
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_PIPELINE_NAME,
  GATEWAY_SPEND_PROCESSING_EVENT_TYPES,
} from "./gateway-spend-constants.adapter";
import {
  AdmitSpendCommand,
  ConfirmSpendCommand,
  FailSpendCommand,
  SettleSpendCommand,
} from "../intents/gateway-spend.intent";
import type { GatewaySpendProcessingEvent } from "./gateway-spend-events.adapter";
import { createGatewaySpendFoldProjection } from "./gateway-spend-fold.adapter";

/**
 * A process manager another feature owns, mounted on this pipeline under the
 * name its durable rows are already keyed by.
 *
 * The name travels with the applier because it is the storage key for every
 * inbox, state and outbox row the process has written: renaming it strands
 * them. Webhook delivery (ADR-073) and the Governance debits both live in
 * packages this one must not depend on, so the composition root builds each
 * applier and hands it over with its name intact.
 */
export interface GatewaySpendProcessManagerMount {
  name: string;
  applier: ProcessManagerApplier<GatewaySpendProcessingEvent>;
}

export interface EventingGatewaySpendAdapterOptions {
  /** The spend ledger the fold reads and writes. The `FoldProjectionStore`
   *  built over it stays private to this feature, which is what
   *  `private-runtime-export` requires of a feature server root. */
  spendEvents: GatewaySpendEventsPort;
  /** Wraps this feature's own fold store before it is mounted, so the
   *  composition root can put its Redis read-through cache in front of a
   *  store it is never handed. Identity when absent. */
  cacheStore?: (
    inner: FoldProjectionStore<GatewaySpendState>,
  ) => FoldProjectionStore<GatewaySpendState>;
  /** The ADR-073 delivery process manager; absent when webhooks are off
   *  (the pipeline still projects, delivery just has no consumer). */
  webhookDelivery?: GatewaySpendProcessManagerMount;
  /** The gateway's budget debits; absent without the ClickHouse spend path
   *  (the ledger is the only spend store). */
  gatewayDebits?: GatewaySpendProcessManagerMount;
  /** The M2 settlement sweeper: settles admissions whose confirmation
   *  never arrived inside the grace window. Its command sender arrives
   *  through `connectSettlement`, because the pipeline that owns the
   *  command is the one being built. */
  settlement?: Omit<SpendSettlementProcessDeps, "sendSettleSpend">;
}

/**
 * The gateway spend pipeline (spend-command spine), and the worker-facing
 * capability that composes it.
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
 *
 * `connectSettlement` is the loop this feature cannot close alone: the
 * sweeper sends `settleSpend`, and that sender is produced by the very
 * registration that mounts the sweeper. The legacy registry closed it by
 * looking the pipeline up by name from inside the sweep, which meant a
 * mis-registered graph failed at settlement time, tenant by tenant. Binding
 * it once, straight after registration, moves that failure to boot.
 */
export class EventingGatewaySpendAdapter {
  static create(options: EventingGatewaySpendAdapterOptions): EventingGatewaySpendAdapter {
    return new EventingGatewaySpendAdapter(options);
  }

  private send: ((data: SettleSpendCommandData) => Promise<void>) | undefined;

  private constructor(private readonly options: EventingGatewaySpendAdapterOptions) {}

  private foldStore(): FoldProjectionStore<GatewaySpendState> {
    const inner = GatewaySpendStore.create(this.options.spendEvents);
    return this.options.cacheStore ? this.options.cacheStore(inner) : inner;
  }

  buildProcessing() {
    let pipeline = definePipeline<GatewaySpendProcessingEvent>({
      name: GATEWAY_SPEND_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: GATEWAY_SPEND_AGGREGATE_TYPE,
        events: defineEvents(GATEWAY_SPEND_PROCESSING_EVENT_TYPES),
      }),
    })
      .withClickHouseFoldProjection(createGatewaySpendFoldProjection(this.foldStore()))
      .withCommand("admitSpend", AdmitSpendCommand)
      .withCommand("confirmSpend", ConfirmSpendCommand)
      .withCommand("failSpend", FailSpendCommand)
      .withCommand("settleSpend", SettleSpendCommand);
    if (this.options.webhookDelivery) {
      pipeline = pipeline.withProcessManager(
        this.options.webhookDelivery.name,
        this.options.webhookDelivery.applier,
      );
    }
    if (this.options.gatewayDebits) {
      pipeline = pipeline.withProcessManager(
        this.options.gatewayDebits.name,
        this.options.gatewayDebits.applier,
      );
    }
    if (this.options.settlement) {
      pipeline = pipeline.withProcessManager(
        SPEND_SETTLEMENT_PROCESS_NAME,
        spendSettlementPM({
          ...this.options.settlement,
          sendSettleSpend: (data) => {
            if (!this.send) {
              throw new Error("Gateway spend cannot settle before its pipeline is registered.");
            }
            return this.send(data);
          },
        }),
      );
    }
    return pipeline.build();
  }

  connectSettlement(sendSettleSpend: (data: SettleSpendCommandData) => Promise<void>): void {
    this.send = sendSettleSpend;
  }
}
