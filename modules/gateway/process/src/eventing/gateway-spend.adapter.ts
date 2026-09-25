import {
  defineAggregate,
  definePipeline,
  type FoldProjectionStore,
  type ProcessManagerApplier,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { WebhookApi } from "@langwatch/webhook-contract";

import type { GatewaySpendEventsRepository } from "../repositories/gateway-spend-events.repository.ts";
import { GatewaySpendStore } from "../stores/gateway-spend/gateway-spend.store.ts";
import type { SettleSpendCommandData } from "./gateway-spend-commands.process.ts";
import {
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_PIPELINE_NAME,
} from "./gateway-spend-commands.process.ts";
import type { SpendSettlementProcessDeps } from "./gateway-spend-settlement.intent.ts";
import {
  SPEND_SETTLEMENT_PROCESS_NAME,
  spendSettlementPM,
} from "./gateway-spend-settlement.process.ts";
import {
  GATEWAY_SPEND_WEBHOOK_SUBSCRIBER_NAME,
  gatewaySpendWebhookSubscriber,
} from "./gateway-spend-webhook.subscriber.ts";
import {
  AdmitSpendCommand,
  ConfirmSpendCommand,
  FailSpendCommand,
  SettleSpendCommand,
  gatewaySpendAdmittedEventSchema,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  gatewaySpendSettledEventSchema,
} from "./gateway-spend.intent.ts";
import type { GatewaySpendProcessingEvent } from "./gateway-spend.intent.ts";
import type { GatewaySpendState } from "./gateway-spend.projection.ts";
import { GatewaySpendFoldProjection } from "./gateway-spend.projection.ts";

/**
 * A process manager another feature owns, mounted here under the name its
 * durable rows are already keyed by — renaming loses inbox/state/outbox
 * rows. Debits live in a module this one may not depend on.
 */
export interface GatewaySpendProcessManagerMount {
  name: string;
  applier: ProcessManagerApplier<GatewaySpendProcessingEvent>;
}

export interface EventingGatewaySpendAdapterOptions {
  /** The spend ledger the fold reads and writes. The `FoldProjectionStore`
   *  built over it stays private to this feature, which is what
   *  `private-runtime-export` requires of a feature server root. */
  spendEvents: GatewaySpendEventsRepository;
  /** Wraps this feature's own fold store before it is mounted, so the
   *  composition root can put its Redis read-through cache in front of a
   *  store it is never handed. Identity when absent. */
  cacheStore?: (
    inner: FoldProjectionStore<GatewaySpendState>,
  ) => FoldProjectionStore<GatewaySpendState>;
  /** Webhook's own delivery op; each committed spend step is handed to it (WP-6c). */
  webhookSpendDelivery?: Pick<WebhookApi, "requestSpendDelivery">;
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
 * The gateway spend pipeline (spend-command spine). One aggregate per
 * request, rated in the fold to integer nano-USD. connectSettlement binds
 * the sweeper's sender at registration, so a mis-registered graph fails at boot.
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

  buildProcessing(): StaticPipelineDefinition<
    GatewaySpendProcessingEvent,
    Record<string, Projection>,
    RegisteredCommand
  > {
    let pipeline = definePipeline({
      name: GATEWAY_SPEND_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: GATEWAY_SPEND_AGGREGATE_TYPE,
      }),
    })
      .withEvents([
        gatewaySpendAdmittedEventSchema,
        gatewaySpendConfirmedEventSchema,
        gatewaySpendFailedEventSchema,
        gatewaySpendSettledEventSchema,
      ])
      .withClickHouseFoldProjection(GatewaySpendFoldProjection.create({ store: this.foldStore() }))
      .withCommand("admitSpend", AdmitSpendCommand)
      .withCommand("confirmSpend", ConfirmSpendCommand)
      .withCommand("failSpend", FailSpendCommand)
      .withCommand("settleSpend", SettleSpendCommand);
    if (this.options.webhookSpendDelivery) {
      pipeline = pipeline.withEventSubscriber(
        GATEWAY_SPEND_WEBHOOK_SUBSCRIBER_NAME,
        gatewaySpendWebhookSubscriber(this.options.webhookSpendDelivery),
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
