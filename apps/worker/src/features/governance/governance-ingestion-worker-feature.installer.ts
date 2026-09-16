import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/**
 * What Governance's ingestion installation hands back: the two command
 * surfaces the API dispatches into, and the lifecycle service the operator
 * routes read and reconcile through.
 */
export interface GovernanceIngestionInstallation<
  TIngestionPull = unknown,
  TPulledUsage = unknown,
  TLifecycle = unknown,
> {
  readonly ingestionPull: TIngestionPull;
  readonly pulledUsage: TPulledUsage;
  readonly lifecycle: TLifecycle;
}

/** Governance ingestion's worker-facing capability, composed by Enterprise. */
export interface GovernanceIngestionWorkerCapability {
  /**
   * Registers the pulled-usage and ingestion-pull pipelines in that order and
   * binds the deferred lifecycle commands, then reconciles the schedules where
   * this process runs workers.
   */
  register(eventSourcing: WorkerEventingRuntime["eventSourcing"]): GovernanceIngestionInstallation;
}

/**
 * Worker registration for Enterprise Governance's ingestion pipelines.
 * Two pipelines in fixed order: pulled usage first, then ingestion pull.
 */
export class GovernanceIngestionWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: GovernanceIngestionWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): GovernanceIngestionWorkerFeatureInstaller {
    return new GovernanceIngestionWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "governance-ingestion";

  private installation: GovernanceIngestionInstallation | undefined;

  private constructor(
    private readonly installer: GovernanceIngestionWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {}

  /**
   * The installed command surfaces and lifecycle service. Refuses rather
   * than returning an empty shape: reading `undefined` here would look like
   * "nothing to report" rather than "not registered yet".
   */
  getInstallation(): GovernanceIngestionInstallation {
    if (!this.installation) {
      throw new Error("Governance ingestion pipelines have not been registered.");
    }
    return this.installation;
  }

  async install(): Promise<WorkerFeatureCloser | undefined> {
    this.installation ??= this.installer.register(this.eventing.eventSourcing);
    return undefined;
  }
}
