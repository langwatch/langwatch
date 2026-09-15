import { EventingLangyMaintenanceAdapter } from "@langwatch/langy-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** The revoke half of the sweep, so a caller can supply one without a database. */
export abstract class WorkerLangySessionKeyReap {
  /** Revokes every elapsed, unrevoked Langy session key; answers how many. */
  abstract reap(): Promise<number>;
}

/**
 * Worker registration for Langy's session-key reaper.
 * Pipeline built here to ensure outbox rows match this process's store.
 */
export class LangyMaintenanceWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    eventing: WorkerEventingRuntime;
    sessionKeyReap: WorkerLangySessionKeyReap;
  }): LangyMaintenanceWorkerFeatureInstaller {
    return new LangyMaintenanceWorkerFeatureInstaller(options.eventing, options.sessionKeyReap);
  }

  readonly name = "langy-maintenance";
  private installed = false;

  private constructor(
    private readonly eventing: WorkerEventingRuntime,
    private readonly sessionKeyReap: WorkerLangySessionKeyReap,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const processStore = this.eventing.processStore;
      this.eventing.eventSourcing.register(
        EventingLangyMaintenanceAdapter.create({
          sessionKeyReap: {
            reap: () => this.sessionKeyReap.reap(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          },
        }).buildProcessing(),
      );
      this.installed = true;
    }
    return undefined;
  }
}
