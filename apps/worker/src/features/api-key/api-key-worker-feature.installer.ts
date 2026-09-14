import { EventingAgentSandboxMaintenanceAdapter } from "@langwatch/api-key-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** The revoke half of the sweep, so a caller can supply one without a database. */
export abstract class WorkerAgentSandboxKeyReap {
  /** Revokes every elapsed, unrevoked sandbox key; answers how many. */
  abstract reap(): Promise<number>;
}

/**
 * Worker registration for agent-sandbox credential maintenance. The pipeline is
 * built here (not received) so outbox rows are pruned by this graph's process store.
 */
export class ApiKeyWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    eventing: WorkerEventingRuntime;
    sandboxKeyReap: WorkerAgentSandboxKeyReap;
  }): ApiKeyWorkerFeatureInstaller {
    return new ApiKeyWorkerFeatureInstaller(options.eventing, options.sandboxKeyReap);
  }

  readonly name = "api-key";
  private installed = false;

  private constructor(
    private readonly eventing: WorkerEventingRuntime,
    private readonly sandboxKeyReap: WorkerAgentSandboxKeyReap,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const processStore = this.eventing.processStore;
      this.eventing.eventSourcing.register(
        EventingAgentSandboxMaintenanceAdapter.create({
          sandboxKeyReap: {
            reap: () => this.sandboxKeyReap.reap(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          },
        }).build(),
      );
      this.installed = true;
    }
    return undefined;
  }
}
