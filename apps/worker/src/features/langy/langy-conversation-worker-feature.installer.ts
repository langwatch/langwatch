import type {
  Event,
  Projection,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/**
 * A registrable Eventing definition, left open in its own event union.
 *
 * `prepareEventForProjection` is contravariant in the event type, so a
 * definition pinned to the base `Event` refuses the very definition a feature
 * publishes over its own discriminated union. The capability below therefore
 * carries the union as a parameter and the installer never names it.
 */
type WorkerPipelineDefinition<TEvent extends Event> = StaticPipelineDefinition<
  TEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/** A command this pipeline appends into, as the registered graph exposes it. */
type WorkerCommandSender = { send(data: unknown): Promise<void> };

/** Langy conversations' worker-facing capability after its graph is composed. */
export interface LangyConversationWorkerCapability<
  TEvent extends Event = Event,
  TFailAgentResponse = unknown,
  TGenerateConversationTitle = unknown,
> {
  /**
   * Builds the conversation definition: the conversation aggregate, its two
   * Postgres folds, the per-message and analytics map projections, the turn
   * process manager and the three live subscribers. Every port the effects
   * need is already bound by the composition root.
   */
  buildProcessing(): WorkerPipelineDefinition<TEvent>;
  /**
   * Hands the pipeline's own effects the two senders they append through.
   *
   * A permanently rejected dispatch fails the turn, and a generated title is
   * saved as an event, so both need commands produced by the very
   * registration that mounts them. Binding them here means a graph missing
   * either command fails at boot rather than leaving a turn hanging.
   */
  connectCommands(commands: {
    failAgentResponse(data: TFailAgentResponse): Promise<void>;
    generateConversationTitle(data: TGenerateConversationTitle): Promise<void>;
  }): void;
}

/**
 * Worker registration for the Langy conversation pipeline.
 *
 * Registered unconditionally: Langy's operational projections are Postgres,
 * so unlike the ClickHouse-gated pipelines there is no configuration under
 * which the graph is meaningless.
 */
export class LangyConversationWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  /**
   * The registration is captured as a closure, and that is what erases the
   * event union.
   *
   * A definition is generic in the discriminated union its feature owns, and
   * `prepareEventForProjection` is contravariant in it — so a field typed
   * against the base `Event` would refuse the very definition Langy publishes,
   * and a class generic in the union would make two instantiations of this
   * installer mutually unassignable wherever the composition root names it.
   * Registering inside `create`, where the union is still known, leaves the
   * class itself free of it.
   */
  static create<TEvent extends Event>(options: {
    installer: LangyConversationWorkerCapability<TEvent>;
    eventing: WorkerEventingRuntime;
  }): LangyConversationWorkerFeatureInstaller {
    return new LangyConversationWorkerFeatureInstaller(
      () => options.eventing.eventSourcing.register(options.installer.buildProcessing()).commands,
      (commands) => options.installer.connectCommands(commands),
    );
  }

  readonly name = "langy-conversation";
  private installed = false;

  private constructor(
    private readonly registerPipeline: () => unknown,
    private readonly connectCommands: (commands: {
      failAgentResponse: (data: never) => Promise<void>;
      generateConversationTitle: (data: never) => Promise<void>;
    }) => void,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const commands = this.registerPipeline() as Record<string, WorkerCommandSender>;
      const failAgentResponse = commands.failAgentResponse;
      const generateConversationTitle = commands.generateConversationTitle;
      if (!failAgentResponse || !generateConversationTitle) {
        throw new Error(
          "Langy conversation pipeline must register failAgentResponse and generateConversationTitle commands.",
        );
      }
      this.connectCommands({
        failAgentResponse: (data: unknown) => failAgentResponse.send(data),
        generateConversationTitle: (data: unknown) => generateConversationTitle.send(data),
      });
      this.installed = true;
    }
    return undefined;
  }
}
