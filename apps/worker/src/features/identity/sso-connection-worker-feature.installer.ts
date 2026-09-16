import type {
  Event,
  Projection,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/**
 * A registrable Eventing definition, left open in its own event union.
 * `prepareEventForProjection` is contravariant in the event type, so pinning
 * to the base `Event` would refuse the connection ledger's own union.
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
   * included. Built by the composition root: its projection store, guards
   * and teardown port are storage/delivery bindings the worker does not own.
   */
  readonly pipeline: WorkerPipelineDefinition<TEvent>;
}

/**
 * Worker registration for the SSO connection pipeline.
 * Only graph that advances TEARDOWN_PENDING to TORN_DOWN via process manager wake.
 */
export class SsoConnectionWorkerFeatureInstaller implements WorkerFeatureInstaller {
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

  private constructor(private readonly registerPipeline: () => unknown) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      this.registerPipeline();
      this.installed = true;
    }
    return undefined;
  }
}
