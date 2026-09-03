import { EventingAgentSandboxMaintenanceAdapter } from "@langwatch/api-key-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** The revoke half of the sweep, so a caller can supply one without a database. */
export abstract class WorkerAgentSandboxKeyReapPort {
  /** Revokes every elapsed, unrevoked sandbox key; answers how many. */
  abstract reap(): Promise<number>;
}

/**
 * Worker registration for agent-sandbox credential maintenance.
 *
 * A sandbox key is minted per code agent run and has nothing that retires it at
 * the end of one, so this hourly sweep is the only thing that revokes an elapsed
 * key. The sweep used to be a closure the legacy registry built over the App's
 * Prisma client; the revoke now belongs to `@langwatch/api-key-server`, and this
 * installer composes the feature's own service rather than being handed a
 * pipeline somebody else built.
 *
 * The pipeline is built HERE rather than received, for the same reason the
 * Eventing substrate's sweeps are: the outbox rows the reap writes have to be
 * the ones this graph's own process store prunes, and a definition built against
 * another store prunes another process's rows.
 */
export class ApiKeyWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    eventing: WorkerEventingRuntime;
    sandboxKeyReap: WorkerAgentSandboxKeyReapPort;
  }): ApiKeyWorkerFeatureInstaller {
    return new ApiKeyWorkerFeatureInstaller(options.eventing, options.sandboxKeyReap);
  }

  readonly name = "api-key";
  private installed = false;

  private constructor(
    private readonly eventing: WorkerEventingRuntime,
    private readonly sandboxKeyReap: WorkerAgentSandboxKeyReapPort,
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
