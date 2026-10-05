import {
  defineEventingModule,
  type EventingSetup,
  defineAggregate,
  definePipeline,
  type FoldProjectionStore,
  type FoldStateRead,
  type ProjectionStoreContext,
  type ProcessManagerApplier,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GatewayModule } from "../app/gateway.app.ts";
import { GatewaySpendEventsRepository } from "../repositories/gateway-spend-events.repository.ts";
import type { GatewayRepositories } from "../repositories/gateway.repositories.ts";
import {
  GATEWAY_SPEND_AGGREGATE_TYPE,
  GATEWAY_SPEND_PIPELINE_NAME,
  type SettleSpendCommandData,
} from "./gateway-spend-commands.process.ts";
import type { SpendSettlementProcessDeps } from "./gateway-spend-settlement.intent.ts";
import {
  SPEND_SETTLEMENT_PROCESS_NAME,
  spendSettlementPM,
} from "./gateway-spend-settlement.process.ts";
import {
  AdmitSpendCommand,
  ConfirmSpendCommand,
  FailSpendCommand,
  SettleSpendCommand,
  gatewaySpendAdmittedEventSchema,
  gatewaySpendConfirmedEventSchema,
  gatewaySpendFailedEventSchema,
  gatewaySpendSettledEventSchema,
  type GatewaySpendProcessingEvent,
} from "./gateway-spend.intent.ts";
import { GatewaySpendFoldProjection, type GatewaySpendState } from "./gateway-spend.projection.ts";

/** gateway_spend, registered by the module that owns it, with its debit and settlement managers. */
export const gatewaySpendEventing = defineEventingModule({
  pipeline: GATEWAY_SPEND_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<GatewayRepositories, GatewayModule>) =>
    app.spendPipeline({ participation }),
  connect: ({ app, commands }) => app.connectSpend(commands),
});

/**
 * A process manager mounted under the name its durable rows are already keyed
 * by: renaming loses inbox/state/outbox rows.
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
  /** The gateway's budget debits (`gatewayDebits`); absent without the
   *  ClickHouse spend path (the ledger is the only spend store). */
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

/** Why every read and write below refuses, in the process's own words. */
function producerOnly(processName: string, capability: string): Error {
  return new Error(
    `${processName} registered the gateway_spend_processing pipeline as a producer only, so it cannot ${capability}. This work belongs to the worker that drains the pipeline.`,
  );
}

/**
 * The spend ledger a process that never folds holds. Every member refuses —
 * a real read here means the graph wired the reconciliation door to this
 * stand-in instead of the real ledger, worth failing loudly.
 */
class ProducerOnlyGatewaySpendEvents extends GatewaySpendEventsRepository {
  constructor(private readonly processName: string) {
    super();
  }

  upsertFromFold(): Promise<void> {
    return Promise.reject(producerOnly(this.processName, "write a spend row from the fold"));
  }

  findForFold(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "read a spend row for the fold"));
  }

  readSpendEventsPage(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "page the spend ledger"));
  }

  walkSpendEvents(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "walk the spend ledger"));
  }

  readSpendSummaries(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "summarise the spend ledger"));
  }

  sumCostNanoUsdByRequestType(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "sum the spend ledger by request type"));
  }

  readEndUserSpend(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "read one end user's spend"));
  }

  sumDaysForOrganizationProjects(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "sum the spend ledger by day"));
  }

  countUsage(): Promise<never> {
    return Promise.reject(producerOnly(this.processName, "count the spend ledger"));
  }
}

/** The gateway-spend pipeline for a process that only sends commands. */
export class GatewaySpendProducerAdapter {
  static create(): GatewaySpendProducerAdapter {
    return new GatewaySpendProducerAdapter();
  }

  private constructor() {}

  /**
   * processName names the refusal, so a stand-in reached by accident says
   * which process reached it, not an anonymous failure.
   */
  createGatewaySpendProducerPipeline(input: {
    processName: string;
  }): ReturnType<EventingGatewaySpendAdapter["buildProcessing"]> {
    return EventingGatewaySpendAdapter.create({
      spendEvents: new ProducerOnlyGatewaySpendEvents(input.processName),
      // No process managers and no settlement sweeper: all three are the
      // worker's, and the sweeper's `connectSettlement` loop is the worker's
      // too. A producer that mounted them would drain the shared queue.
    }).buildProcessing();
  }
}

/**
 * FoldProjectionStore adapter for the gateway spend fold. `gateway_spend` round-trips the
 * WHOLE working state, so `get` decodes the last committed row; a version-stamped miss needs
 * `refoldOnStoreMiss` reintroduced, or it overwrites partial state from init().
 */
export class GatewaySpendStore implements FoldProjectionStore<GatewaySpendState> {
  static create(repo: GatewaySpendEventsRepository): GatewaySpendStore {
    return new GatewaySpendStore(repo);
  }

  private constructor(private readonly repo: GatewaySpendEventsRepository) {}

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<GatewaySpendState>> {
    const folded = await this.repo.findForFold({
      tenantId: String(context.tenantId),
      gatewayRequestId: aggregateId,
    });
    return folded === null ? { kind: "empty" } : { kind: "folded", state: folded };
  }

  async store(state: GatewaySpendState, context: ProjectionStoreContext): Promise<void> {
    await this.repo.upsertFromFold([
      {
        tenantId: String(context.tenantId),
        gatewayRequestId: String(context.aggregateId),
        state,
      },
    ]);
  }

  async storeBatch(
    entries: {
      state: GatewaySpendState;
      context: ProjectionStoreContext;
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.repo.upsertFromFold(
      entries.map(({ state, context }) => ({
        tenantId: String(context.tenantId),
        gatewayRequestId: String(context.aggregateId),
        state,
      })),
    );
  }
}
