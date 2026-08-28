import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<
  WorkerEventingRuntime["eventSourcing"]["register"]
>[0];

/**
 * The two Governance signal senders the Gateway spend pipeline delivers into.
 *
 * A virtual key's lifecycle and a budget crossing are the only two facts the
 * spend spine hands to Governance, and both are appends rather than requests,
 * which is why the delivery seam is a pair of command senders and not a
 * service.
 */
export interface GovernanceEventsWorkerCommands<
  TVkLifecycle = unknown,
  TBudgetCrossing = unknown,
> {
  recordVkLifecycle: CommandDispatcher<TVkLifecycle>;
  recordBudgetCrossing: CommandDispatcher<TBudgetCrossing>;
}

/** Governance events' worker-facing capability after its graph is composed. */
export interface GovernanceEventsWorkerCapability {
  /**
   * Builds the governance events definition, including the ADR-073 webhook
   * delivery process manager where a delivery graph was supplied. Whether that
   * process manager is mounted is the composition root's decision, taken once,
   * rather than a flag read here.
   */
  buildProcessing(): WorkerPipelineDefinition;
}

/**
 * Worker registration for the Governance events pipeline.
 *
 * It installs immediately before Gateway spend and only alongside it. In the
 * legacy registry both were registered under one `if (gatewaySpend)` guard,
 * because the spend pipeline's debit adapter delivers through this pipeline's
 * commands: registering this one without the spend pipeline mounts a webhook
 * delivery process with no producer, and registering spend without this one
 * leaves its debits with nowhere to land. Keeping them a pair is what
 * preserves that.
 */
export class GovernanceEventsWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: GovernanceEventsWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): GovernanceEventsWorkerFeatureInstaller {
    return new GovernanceEventsWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "governance-events";

  private readonly vkLifecycle = new Deferred<CommandDispatcher<unknown>>(
    "governanceEvents.recordVkLifecycle",
  );
  private readonly budgetCrossing = new Deferred<CommandDispatcher<unknown>>(
    "governanceEvents.recordBudgetCrossing",
  );

  /** Callable proxies for the Gateway spend debit adapter's delivery port. */
  readonly commands: GovernanceEventsWorkerCommands = {
    recordVkLifecycle: this.vkLifecycle.fn,
    recordBudgetCrossing: this.budgetCrossing.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: GovernanceEventsWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
      const vkLifecycle = commands.recordVkLifecycle;
      const budgetCrossing = commands.recordBudgetCrossing;
      if (!vkLifecycle || !budgetCrossing) {
        throw new Error(
          "Governance events pipeline must register recordVkLifecycle and recordBudgetCrossing commands.",
        );
      }
      this.vkLifecycle.resolve((data) => vkLifecycle.send(data));
      this.budgetCrossing.resolve((data) => budgetCrossing.send(data));
      this.installed = true;
    }
    return GovernanceEventsWorkerFeatureHandle.create();
  }
}

class GovernanceEventsWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): GovernanceEventsWorkerFeatureHandle {
    return new GovernanceEventsWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
