import type { ScimSyncPipeline } from "@langwatch/identity-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** Directory sync's worker-facing capability: the built pipeline definition. */
export interface ScimSyncWorkerCapability {
  /**
   * The directory-sync pipeline (D08). Built by the composition root from
   * `PostgresScimSyncPipelineAdapter`: projection store and guards are one
   * `ScimSyncState` repository in two roles, over the one Prisma client opened.
   */
  readonly pipeline: ScimSyncPipeline;
}

/**
 * Worker registration for the directory-sync pipeline.
 * Has no process manager — SCIM retries are provider-driven, not timer-based.
 */
export class ScimSyncWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: ScimSyncWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): ScimSyncWorkerFeatureInstaller {
    return new ScimSyncWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "scim-sync";
  private installed = false;

  private constructor(
    private readonly installer: ScimSyncWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installed = true;
    }
    return undefined;
  }
}
