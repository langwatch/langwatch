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
 * to the base `Event` would refuse a feature's own discriminated union.
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
   * Builds the conversation definition: the aggregate, its two Postgres
   * folds, the message and analytics projections, the turn process manager
   * and three live subscribers — every port their effects need is prebound.
   */
  buildProcessing(): WorkerPipelineDefinition<TEvent>;
  /**
   * Hands the pipeline's own effects the two senders they append through.
   * Both need commands produced by the very registration that mounts them,
   * so binding here fails a graph missing either command at boot, not mid-turn.
   */
  connectCommands(commands: {
    failAgentResponse(data: TFailAgentResponse): Promise<void>;
    generateConversationTitle(data: TGenerateConversationTitle): Promise<void>;
  }): void;
}

/**
 * Worker registration for the Langy conversation pipeline. Registered
 * unconditionally: Langy's projections are Postgres, so unlike the
 * ClickHouse-gated pipelines, no configuration makes this graph meaningless.
 */
export class LangyConversationWorkerFeatureInstaller implements WorkerFeatureInstaller {
  /**
   * Registration inside create() erases the event union through closure.
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
