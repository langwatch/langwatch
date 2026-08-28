import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/** Identity's worker-facing capability: the built pipeline definition. */
export interface IdentityWorkerCapability {
  /**
   * The identity pipeline (ADR-101 / D01 identifiers, and D06 two-step
   * verification on the same aggregate).
   *
   * Built by the composition root rather than here, because every dependency
   * it takes — the two projection stores and the two guard instances — is a
   * storage-engine binding the worker does not own.
   */
  readonly pipeline: WorkerPipelineDefinition;
}

/**
 * Worker registration for the identity pipeline.
 *
 * It has no ordering requirement against the other three identity pipelines:
 * none of them subscribes to another's events, and the app's ledger writers
 * resolve their sender lazily by pipeline NAME on first use rather than
 * closing over a handle at composition time.
 *
 * Registering it IS a behaviour change, and a deliberate one. Nothing mounted
 * this pipeline before — not the legacy `PipelineRegistry`, not any worker
 * graph — so its commands had nowhere to stage and its fold never ran. What
 * keeps a deploy quiet is the per-user write gate
 * (`app-layer/identity/write-gate.ts`), which ships CLOSED and opens only for
 * a user whose backfill is finalized.
 */
export class IdentityWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: IdentityWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): IdentityWorkerFeatureInstaller {
    return new IdentityWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "identity";
  private installed = false;

  private constructor(
    private readonly installer: IdentityWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installed = true;
    }
    return IdentityWorkerFeatureHandle.create();
  }
}

class IdentityWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): IdentityWorkerFeatureHandle {
    return new IdentityWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
