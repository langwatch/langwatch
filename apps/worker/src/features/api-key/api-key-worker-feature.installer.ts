import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** API keys' worker-facing capability: the credential maintenance pipeline. */
export interface ApiKeyWorkerCapability {
  /**
   * Builds the agent-sandbox key sweep against the worker's own process store,
   * so the outbox rows the reap writes are the ones its retention prunes.
   */
  buildMaintenance(options: {
    processStore: WorkerEventingRuntime["processStore"];
  }): Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];
}

/**
 * Worker registration for agent-sandbox credential maintenance.
 *
 * A sandbox key is minted per code agent run and has nothing that retires it
 * at the end of one, so this hourly sweep is the only thing that revokes an
 * elapsed key. It is the same class of defect the Langy session-key reaper
 * had — written, unit-tested, and mounted by nothing — except that this one
 * was never wired at all: `PipelineRegistry` has never carried a reference to
 * `agent_sandbox_maintenance`, in any revision.
 *
 * Registering it IS a behaviour change, and the first tick after it lands
 * clears the whole historical backlog of keys the sweep has never reached.
 * That backlog is inert either way — `ApiKeyService.verify` already refuses an
 * elapsed key — so what changes is the row state, not what any credential can
 * do.
 */
export class ApiKeyWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: ApiKeyWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): ApiKeyWorkerFeatureInstaller {
    return new ApiKeyWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "api-key";
  private installed = false;

  private constructor(
    private readonly installer: ApiKeyWorkerCapability,
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
    return ApiKeyWorkerFeatureHandle.create();
  }
}

class ApiKeyWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): ApiKeyWorkerFeatureHandle {
    return new ApiKeyWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
