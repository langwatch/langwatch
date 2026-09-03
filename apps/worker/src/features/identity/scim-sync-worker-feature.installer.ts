import type { ScimSyncPipeline } from "@langwatch/identity-server";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** Directory sync's worker-facing capability: the built pipeline definition. */
export interface ScimSyncWorkerCapability {
  /**
   * The directory-sync pipeline (D08).
   *
   * Built by the composition root from `PostgresScimSyncPipelineAdapter`: its
   * projection store and its guards are one `ScimSyncState` repository in two
   * roles, over the one Prisma client this process opened.
   */
  readonly pipeline: ScimSyncPipeline;
}

/**
 * Worker registration for the directory-sync pipeline.
 *
 * It has NO process manager, deliberately: a SCIM push is a request an
 * identity provider makes and retries on its own schedule, so the retry this
 * aggregate records is the directory's rather than ours. That means this
 * installer registers a fold and five command lanes and nothing that wakes on
 * a timer — an unregistered pipeline here loses writes, not a sweep.
 *
 * It runs today: the legacy `PipelineRegistry` registers this pipeline as
 * well, and the two definitions are twins until the cutover — the application
 * keeps its own for the producer surface, and this graph is the consumer.
 * What keeps the move quiet is `SCIM_V2_GRANTS`, which defaults off, so no
 * SCIM request path dispatches these commands and the previous write path is
 * unchanged. Whoever makes the worker composition the live one drops the
 * legacy registration in the same change.
 */
export class ScimSyncWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
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
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installed = true;
    }
    return ScimSyncWorkerFeatureHandle.create();
  }
}

class ScimSyncWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): ScimSyncWorkerFeatureHandle {
    return new ScimSyncWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
