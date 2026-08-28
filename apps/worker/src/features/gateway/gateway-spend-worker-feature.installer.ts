import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<
  WorkerEventingRuntime["eventSourcing"]["register"]
>[0];

/** Gateway spend's worker-facing capability after its graph is composed. */
export interface GatewaySpendWorkerCapability<TSettleSpend = unknown> {
  /**
   * Builds the spend definition: gateway requests as aggregates, spend records
   * as a fold over `gateway_spend`, and rating inside the pipeline. The
   * settlement sweeper, the webhook delivery process manager and the debit
   * adapter are already bound by the composition root.
   */
  buildProcessing(): WorkerPipelineDefinition;
  /**
   * Hands the settlement sweeper its own pipeline's `settleSpend` sender.
   *
   * The sweeper is part of the definition being built, so it cannot receive
   * the sender as a constructor argument. The legacy registry resolved this by
   * looking the pipeline up by name from inside the sweep, which meant a
   * mis-registered graph failed at settlement time, tenant by tenant. Binding
   * it once here moves that failure to boot.
   */
  connectSettlement(sendSettleSpend: (data: TSettleSpend) => Promise<void>): void;
}

/**
 * Worker registration for the Gateway spend pipeline.
 *
 * Registered only where ClickHouse is on, because the spend table has no
 * Postgres fallback, and always immediately after Governance events, whose
 * commands its debit adapter delivers into.
 */
export class GatewaySpendWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: GatewaySpendWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): GatewaySpendWorkerFeatureInstaller {
    return new GatewaySpendWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "gateway-spend";
  private installed = false;

  private constructor(
    private readonly installer: GatewaySpendWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
      const settleSpend = commands.settleSpend;
      if (!settleSpend) {
        throw new Error("Gateway spend pipeline must register a settleSpend command.");
      }
      this.installer.connectSettlement((data) => settleSpend.send(data));
      this.installed = true;
    }
    return GatewaySpendWorkerFeatureHandle.create();
  }
}

class GatewaySpendWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): GatewaySpendWorkerFeatureHandle {
    return new GatewaySpendWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
