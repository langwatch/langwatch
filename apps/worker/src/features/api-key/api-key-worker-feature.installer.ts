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
 * elapsed key.
 *
 * It runs today: the legacy `PipelineRegistry` picked `agent_sandbox_maintenance`
 * up after this installer was written, so this is where the sweep MOVES to,
 * not where it starts. Whoever makes the worker composition the live one drops
 * the legacy registration in the same change — two graphs registering one
 * pipeline name in a single process is not a migration step, it is a bug.
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
