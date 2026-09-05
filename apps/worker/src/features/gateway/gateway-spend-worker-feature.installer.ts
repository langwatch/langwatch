import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import {
  GatewaySpendConfirmationPort,
  type ConfirmSpendCommandData,
} from "@langwatch/gateway-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/** Gateway spend's worker-facing capability after its graph is composed. */
export interface GatewaySpendWorkerCapability<TSettleSpend = unknown> {
  /**
   * Builds the spend definition: gateway requests as aggregates, spend records as a fold over
   * `gateway_spend`, and rating inside the pipeline. The settlement sweeper, the webhook delivery
   * process manager and the debit adapter are already bound by the composition root.
   */
  buildProcessing(): WorkerPipelineDefinition;
  /**
   * Hands the settlement sweeper its own pipeline's `settleSpend` sender. The sweeper is part of
   * the definition being built, so it cannot receive the sender as a constructor argument.
   */
  connectSettlement(sendSettleSpend: (data: TSettleSpend) => Promise<void>): void;
}

/**
 * Worker registration for the Gateway spend pipeline. Registered only where ClickHouse is on,
 * because the spend table has no Postgres fallback, and always immediately after Governance events,
 * whose commands its debit adapter delivers into.
 */
export class GatewaySpendWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    installer: GatewaySpendWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): GatewaySpendWorkerFeatureInstaller {
    return new GatewaySpendWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "gateway-spend";

  private readonly confirmSpend = new Deferred<CommandDispatcher<ConfirmSpendCommandData>>(
    "gatewaySpend.confirmSpend",
  );

  /**
   * The pipeline's own `confirmSpend`, safe to hand over before this installer runs. The realtime
   * voice reconciler confirms a settled call through it, and the reconciler is composed before any
   * pipeline is registered.
   */
  readonly spendConfirmation: GatewaySpendConfirmationPort = new DeferredGatewaySpendConfirmation(
    this.confirmSpend.fn,
  );

  private installed = false;

  private constructor(
    private readonly installer: GatewaySpendWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
      const settleSpend = commands.settleSpend;
      if (!settleSpend) {
        throw new Error("Gateway spend pipeline must register a settleSpend command.");
      }
      const confirmSpend = commands.confirmSpend;
      if (!confirmSpend) {
        throw new Error("Gateway spend pipeline must register a confirmSpend command.");
      }
      this.confirmSpend.resolve((data) => confirmSpend.send(data));
      this.installer.connectSettlement((data) => settleSpend.send(data));
      this.installed = true;
    }
    return undefined;
  }
}

/** The pipeline's `confirmSpend`, behind the port a voice settlement asks for. */
class DeferredGatewaySpendConfirmation extends GatewaySpendConfirmationPort {
  constructor(private readonly send: CommandDispatcher<ConfirmSpendCommandData>) {
    super();
  }

  confirmSpend(data: ConfirmSpendCommandData): Promise<void> {
    return this.send(data);
  }
}
