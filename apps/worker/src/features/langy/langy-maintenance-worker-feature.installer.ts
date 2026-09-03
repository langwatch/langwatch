import { EventingLangyMaintenanceAdapter } from "@langwatch/langy-server";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstallerPort,
} from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** The revoke half of the sweep, so a caller can supply one without a database. */
export abstract class WorkerLangySessionKeyReapPort {
  /** Revokes every elapsed, unrevoked Langy session key; answers how many. */
  abstract reap(): Promise<number>;
}

/**
 * Worker registration for Langy's session-key reaper.
 *
 * Registered unconditionally, on the same footing as the Eventing substrate's
 * own sweeps: the reaper existed, was tested and was routed for cron, and then
 * never scheduled, because the chart ships no CronJobs. Mounting it here is
 * what finally gives the backstop for keys orphaned by a SIGKILLed manager a
 * caller.
 *
 * The pipeline is built HERE rather than received, for the same reason the
 * API-key sweep's is: the outbox rows the reap writes have to be the ones this
 * graph's own process store prunes, and a definition built against another
 * store prunes another process's rows.
 */
export class LangyMaintenanceWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    eventing: WorkerEventingRuntime;
    sessionKeyReap: WorkerLangySessionKeyReapPort;
  }): LangyMaintenanceWorkerFeatureInstaller {
    return new LangyMaintenanceWorkerFeatureInstaller(options.eventing, options.sessionKeyReap);
  }

  readonly name = "langy-maintenance";
  private installed = false;

  private constructor(
    private readonly eventing: WorkerEventingRuntime,
    private readonly sessionKeyReap: WorkerLangySessionKeyReapPort,
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
