import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/** SSO connections' worker-facing capability: the built pipeline definition. */
export interface SsoConnectionWorkerCapability {
  /**
   * The SSO connection pipeline (D04, ADR-117 §5), teardown grace timer
   * included.
   *
   * Built by the composition root: its projection store, its guards and the
   * teardown port are storage and delivery bindings the worker does not own.
   */
  readonly pipeline: WorkerPipelineDefinition;
}

/**
 * Worker registration for the SSO connection pipeline.
 *
 * This is the only graph that can advance TEARDOWN_PENDING to TORN_DOWN: the
 * transition happens through the process manager's wake and nowhere else, so
 * a connection whose teardown was requested sits at the pending state for as
 * long as no process registers this pipeline.
 *
 * It runs today: the legacy `PipelineRegistry` registers this pipeline, so
 * this is where it MOVES to. What keeps the move quiet is `SSOCONN_ROUTING`,
 * which defaults to `off`, so no sign-in decision reads this projection and
 * the grandfather migration remains the only production writer. Whoever makes
 * the worker composition the live one drops the legacy registration in the
 * same change.
 */
export class SsoConnectionWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: SsoConnectionWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): SsoConnectionWorkerFeatureInstaller {
    return new SsoConnectionWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "sso-connection";
  private installed = false;

  private constructor(
    private readonly installer: SsoConnectionWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(this.installer.pipeline);
      this.installed = true;
    }
    return SsoConnectionWorkerFeatureHandle.create();
  }
}

class SsoConnectionWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): SsoConnectionWorkerFeatureHandle {
    return new SsoConnectionWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
