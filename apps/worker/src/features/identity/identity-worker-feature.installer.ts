import type { IdentityPipeline } from "@langwatch/identity-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** Identity's worker-facing capability: the built pipeline definition. */
export interface IdentityWorkerCapability {
  /**
   * The identity pipeline (ADR-101 / D01 identifiers, D06 two-step verification).
   * Built by the composition root from PostgresIdentityPipelineAdapter.
   */
  readonly pipeline: IdentityPipeline;
}

/**
 * Worker registration for the identity pipeline.
 * No ordering requirement with other identity pipelines — they're independent.
 */
export class IdentityWorkerFeatureInstaller implements WorkerFeatureInstaller {
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
