import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** GitHub's worker-facing capability: the maintenance pipeline definition. */
export interface GithubWorkerCapability {
  /**
   * Builds the branch-recheck and retention pipeline against the worker's own
   * process store, so the outbox the prune reaps is the one the recheck wrote.
   */
  buildMaintenance(options: {
    processStore: WorkerEventingRuntime["processStore"];
  }): Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];
}

/**
 * Worker registration for GitHub pull-request linkage maintenance.
 *
 * The sweep used to be a `setTimeout` chain booted on every replica with no
 * lock, so the fleet ran the same cross-tenant scan N times every ten minutes.
 * It is a scheduled process manager now, and the wake commit is what fences
 * racing workers — which only holds while exactly one graph registers it.
 */
export class GithubWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: GithubWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): GithubWorkerFeatureInstaller {
    return new GithubWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "github";
  private installed = false;

  private constructor(
    private readonly installer: GithubWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(
        this.installer.buildMaintenance({ processStore: this.eventing.processStore }),
      );
      this.installed = true;
    }
    return GithubWorkerFeatureHandle.create();
  }
}

class GithubWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): GithubWorkerFeatureHandle {
    return new GithubWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
