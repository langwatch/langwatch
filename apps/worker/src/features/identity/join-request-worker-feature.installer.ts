import type { JoinRequestPipeline } from "@langwatch/identity-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** Join requests' worker-facing capability: the built pipeline definition. */
export interface JoinRequestWorkerCapability {
  /**
   * The join-request pipeline (D12, ADR-117) with day-7 reminder and day-14 expiry.
   * Built by composition root from PostgresJoinRequestPipelineAdapter.
   */
  readonly pipeline: JoinRequestPipeline;
}

/**
 * Worker registration for the join-request pipeline.
 * Carries the only two timers: day-7 reminder and day-14 expiry.
 */
export class JoinRequestWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: JoinRequestWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): JoinRequestWorkerFeatureInstaller {
    return new JoinRequestWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "join-request";
  private installed = false;

  private constructor(
    private readonly installer: JoinRequestWorkerCapability,
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
