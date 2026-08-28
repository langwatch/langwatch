import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

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
  register(
    eventSourcing: WorkerEventingRuntime["eventSourcing"],
  ): GovernanceIngestionInstallation;
}

/**
 * Worker registration for Enterprise Governance's ingestion pipelines.
 *
 * Two pipelines register here, and their order is fixed by a binding rather
 * than by preference: pulled usage first, because the ingestion-pull run port
 * dispatches its observations, and ingestion pull second, whose own lifecycle
 * commands are bound back into a deferred pipeline handle immediately after.
 * The Enterprise adapter owns that sequence; this installer owns only when it
 * runs relative to the rest of the worker graph.
 *
 * Schedule reconciliation is the adapter's, fired once per boot and
 * deliberately not awaited: a Governance installation whose reconcile pass
 * fails logs and retries next boot rather than refusing to start the worker.
 */
export class GovernanceIngestionWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
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
  ) {
    super();
  }

  /**
   * The installed command surfaces and lifecycle service.
   *
   * It refuses rather than returning an empty shape, because a caller that
   * read `undefined` here would take a Governance installation that had not
   * registered for one that had nothing to report.
   */
  getInstallation(): GovernanceIngestionInstallation {
    if (!this.installation) {
      throw new Error("Governance ingestion pipelines have not been registered.");
    }
    return this.installation;
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    this.installation ??= this.installer.register(this.eventing.eventSourcing);
    return GovernanceIngestionWorkerFeatureHandle.create();
  }
}

class GovernanceIngestionWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): GovernanceIngestionWorkerFeatureHandle {
    return new GovernanceIngestionWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
