import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/** Billing reporting's worker-facing capability after its graph is composed. */
export interface BillingReportingWorkerCapability<TReportUsage = unknown> {
  buildProcessing(): WorkerPipelineDefinition;
  /**
   * Hands the month-report command its own pipeline's sender.
   *
   * The command re-dispatches itself to walk a month forward, so the sender it
   * needs is produced by the very registration that consumes it. The legacy
   * registry closed that loop by looking the pipeline up by name at dispatch
   * time; binding it once at registration moves a mis-registered graph's
   * failure from the first monthly roll-up to boot.
   */
  connectSelfDispatch(sendReportUsageForMonth: (data: TReportUsage) => Promise<void>): void;
}

/**
 * Worker registration for the Billing reporting pipeline.
 *
 * On a SaaS install the global billable-events meter projection mounts a
 * subscriber that dispatches `reportUsageForMonth`. That projection is
 * registered on the Eventing runtime itself rather than on a pipeline, so it
 * is configured before any pipeline exists — which is exactly why the sender
 * it closes over is the proxy published here and not a direct handle.
 */
export class BillingReportingWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: BillingReportingWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): BillingReportingWorkerFeatureInstaller {
    return new BillingReportingWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "billing-reporting";

  private readonly reportUsageForMonth = new Deferred<CommandDispatcher<unknown>>(
    "billingReporting.reportUsageForMonth",
  );

  /** Callable proxy for the SaaS billable-events meter dispatch subscriber. */
  readonly commands: { reportUsageForMonth: CommandDispatcher<unknown> } = {
    reportUsageForMonth: this.reportUsageForMonth.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: BillingReportingWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
      const reportUsage = commands.reportUsageForMonth;
      if (!reportUsage) {
        throw new Error("Billing reporting pipeline must register a reportUsageForMonth command.");
      }
      const dispatch: CommandDispatcher<unknown> = (data) => reportUsage.send(data);
      this.reportUsageForMonth.resolve(dispatch);
      this.installer.connectSelfDispatch((data) => dispatch(data));
      this.installed = true;
    }
    return BillingReportingWorkerFeatureHandle.create();
  }
}

class BillingReportingWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): BillingReportingWorkerFeatureHandle {
    return new BillingReportingWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
