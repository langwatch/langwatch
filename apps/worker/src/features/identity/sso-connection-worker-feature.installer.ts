import type {
  Event,
  Projection,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "@langwatch/eventing";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/**
 * A registrable Eventing definition, left open in its own event union.
 *
 * `prepareEventForProjection` is contravariant in the event type, so a
 * definition pinned to the base `Event` refuses the very definition the
 * connection ledger publishes over its own discriminated union.
 */
type WorkerPipelineDefinition<TEvent extends Event> = StaticPipelineDefinition<
  TEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/** SSO connections' worker-facing capability: the built pipeline definition. */
export interface SsoConnectionWorkerCapability<TEvent extends Event = Event> {
  /**
   * The SSO connection pipeline (D04, ADR-117 §5), teardown grace timer
   * included.
   *
   * Built by the composition root: its projection store, its guards and the
   * teardown port are storage and delivery bindings the worker does not own.
   */
  readonly pipeline: WorkerPipelineDefinition<TEvent>;
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
  static create<TEvent extends Event>(options: {
    installer: SsoConnectionWorkerCapability<TEvent>;
    eventing: WorkerEventingRuntime;
  }): SsoConnectionWorkerFeatureInstaller {
    return new SsoConnectionWorkerFeatureInstaller(() =>
      options.eventing.eventSourcing.register(options.installer.pipeline),
    );
  }

  readonly name = "sso-connection";
  private installed = false;

  private constructor(private readonly registerPipeline: () => unknown) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.registerPipeline();
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
