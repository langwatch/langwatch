import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/** Langy credential maintenance's worker-facing capability. */
export interface LangyMaintenanceWorkerCapability {
  /**
   * Builds the maintenance definition: one scheduled process, no events and
   * no commands, so it registers no subscriber and costs nothing beyond the
   * wake it exists for.
   */
  buildProcessing(): WorkerPipelineDefinition;
}

/**
 * Worker registration for Langy's session-key reaper.
 *
 * Registered unconditionally, on the same footing as the Eventing substrate's
 * own sweeps: the reaper existed, was tested and was routed for cron, and then
 * never scheduled, because the chart ships no CronJobs. Mounting it here is
 * what finally gives the backstop for keys orphaned by a SIGKILLed manager a
 * caller.
 */
export class LangyMaintenanceWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: LangyMaintenanceWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): LangyMaintenanceWorkerFeatureInstaller {
    return new LangyMaintenanceWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "langy-maintenance";
  private installed = false;

  private constructor(
    private readonly installer: LangyMaintenanceWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.buildProcessing());
      this.installed = true;
    }
    return LangyMaintenanceWorkerFeatureHandle.create();
  }
}

class LangyMaintenanceWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): LangyMaintenanceWorkerFeatureHandle {
    return new LangyMaintenanceWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
