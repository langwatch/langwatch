import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/** Join requests' worker-facing capability: the built pipeline definition. */
export interface JoinRequestWorkerCapability {
  /**
   * The join-request pipeline (D12, ADR-117), with the day-7 reminder and the
   * day-14 expiry on one wake column.
   *
   * Built by the composition root: its projection store, its guards and the
   * lifecycle port are storage and delivery bindings the worker does not own.
   */
  readonly pipeline: WorkerPipelineDefinition;
}

/**
 * Worker registration for the join-request pipeline.
 *
 * It carries the only two timers a request has. PENDING to EXPIRED happens
 * through this wake and nowhere else, and the day-7 reminder is the only nudge
 * an admin ever gets about a request — so with no process registering this
 * pipeline, a pending request neither expires nor reminds anyone.
 *
 * It runs today: the legacy `PipelineRegistry` registers this pipeline, so
 * this is where it MOVES to. What keeps the move quiet is the `JOIN_REQUESTS`
 * flag, which defaults off: no command is dispatched, no interstitial renders,
 * and no panel appears. Whoever makes the worker composition the live one
 * drops the legacy registration in the same change.
 */
export class JoinRequestWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
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
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installed = true;
    }
    return JoinRequestWorkerFeatureHandle.create();
  }
}

class JoinRequestWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): JoinRequestWorkerFeatureHandle {
    return new JoinRequestWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
