import type { IdentityPipeline } from "@langwatch/identity-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** Identity's worker-facing capability: the built pipeline definition. */
export interface IdentityWorkerCapability {
  /**
   * The identity pipeline (ADR-101 / D01 identifiers, and D06 two-step
   * verification on the same aggregate).
   *
   * Built by the composition root rather than here, from
   * `PostgresIdentityPipelineAdapter` over the one Prisma client this process
   * opened: the two projection stores and the two guard instances are all
   * Postgres bindings, and the address lock the guards claim through is the
   * same instance the fold releases through.
   */
  readonly pipeline: IdentityPipeline;
}

/**
 * Worker registration for the identity pipeline.
 *
 * It has no ordering requirement against the other three identity pipelines:
 * none of them subscribes to another's events, and the app's ledger writers
 * resolve their sender lazily by pipeline NAME on first use rather than
 * closing over a handle at composition time.
 *
 * It runs today: the legacy `PipelineRegistry` registers this pipeline as
 * well, and the two definitions are twins until the cutover — the application
 * keeps its own for the producer surface its writers resolve a sender from,
 * and this graph is the consumer. What keeps the move quiet is the per-user
 * write gate (`app-layer/identity/write-gate.ts`), which ships CLOSED and
 * opens only for a user whose backfill is finalized. Whoever makes the worker
 * composition the live one drops the legacy registration in the same change.
 */
export class IdentityWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
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
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installed = true;
    }
    return undefined;
  }
}
