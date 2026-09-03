import type { JoinRequestPipeline } from "@langwatch/identity-server";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstallerPort,
} from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** Join requests' worker-facing capability: the built pipeline definition. */
export interface JoinRequestWorkerCapability {
  /**
   * The join-request pipeline (D12, ADR-117), with the day-7 reminder and the
   * day-14 expiry on one wake column.
   *
   * Built by the composition root from `PostgresJoinRequestPipelineAdapter`
   * over the one Prisma client this process opened and the one mail gateway it
   * composed: the `JoinRequest` head serves both the fold and its guards, and
   * the lifecycle port's two wakes are the only notifications a request ever
   * produces on its own.
   */
  readonly pipeline: JoinRequestPipeline;
}

/**
 * Worker registration for the join-request pipeline.
 *
 * It carries the only two timers a request has. PENDING to EXPIRED happens
 * through this wake and nowhere else, and the day-7 reminder is the only nudge
 * an admin ever gets about a request — so with no process registering this
 * pipeline, a pending request neither expires nor reminds anyone.
 *
 * It runs today: the legacy `PipelineRegistry` registers this pipeline as
 * well, and the two definitions are twins until the cutover — the application
 * keeps its own for the producer surface its writers resolve a sender from,
 * and this graph is the consumer. What keeps the move quiet is the
 * `JOIN_REQUESTS` flag, which defaults off: no command is dispatched, no
 * interstitial renders, and no panel appears. Whoever makes the worker
 * composition the live one drops the legacy registration in the same change.
 */
export class JoinRequestWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
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
