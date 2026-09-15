import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/** Billing reporting's worker-facing capability after its graph is composed. */
export interface BillingReportingWorkerCapability<TReportUsage = unknown> {
  buildProcessing(): WorkerPipelineDefinition;
  /**
   * Hands the month-report command its own pipeline's sender. Binding at
   * registration moves failures from first roll-up to boot.
   */
  connectSelfDispatch(sendReportUsageForMonth: (data: TReportUsage) => Promise<void>): void;
}

/**
 * Worker registration for the Billing reporting pipeline. Uses a proxy sender
 * because the projection is configured before the pipeline exists.
 */
export class BillingReportingWorkerFeatureInstaller implements WorkerFeatureInstaller {
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
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
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
    return undefined;
  }
}
