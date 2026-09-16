import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/**
 * The two Governance signal senders the Gateway spend pipeline delivers into:
 * a virtual key's lifecycle and a budget crossing, the only two facts handed
 * over. Both are appends, not requests — hence senders, not a service.
 */
export interface GovernanceEventsWorkerCommands<TVkLifecycle = unknown, TBudgetCrossing = unknown> {
  recordVkLifecycle: CommandDispatcher<TVkLifecycle>;
  recordBudgetCrossing: CommandDispatcher<TBudgetCrossing>;
}

/** Governance events' worker-facing capability after its graph is composed. */
export interface GovernanceEventsWorkerCapability {
  /**
   * Builds the governance events definition, including the ADR-073 webhook
   * delivery process manager where a delivery graph was supplied. Mounting it
   * is the composition root's decision, taken once, not a flag read here.
   */
  buildProcessing(): WorkerPipelineDefinition;
}

/**
 * Worker registration for the Governance events pipeline.
 * Installs alongside Gateway spend — they're paired in the delivery contract.
 */
export class GovernanceEventsWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: GovernanceEventsWorkerCapability;
    eventing: WorkerEventingRuntime;
    /**
     * The spend-spike anomaly evaluator, when this process composed one.
     * Rides this installer because its alerts are governance signals sharing the delivery path.
     */
    anomalySchedule?: GovernanceAnomalySchedule;
  }): GovernanceEventsWorkerFeatureInstaller {
    return new GovernanceEventsWorkerFeatureInstaller(
      options.installer,
      options.eventing,
      options.anomalySchedule,
    );
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
    private readonly anomalySchedule: GovernanceAnomalySchedule | undefined,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
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
      this.anomalySchedule?.start();
      this.installed = true;
    }
    const anomalySchedule = this.anomalySchedule;
    return anomalySchedule ? () => anomalySchedule.stop() : undefined;
  }
}

/** The spend-spike evaluator's lifecycle, as this installer drives it. */
export interface GovernanceAnomalySchedule {
  start(): void;
  stop(): Promise<void>;
}
