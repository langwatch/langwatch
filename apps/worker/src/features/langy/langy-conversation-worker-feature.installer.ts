import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<
  WorkerEventingRuntime["eventSourcing"]["register"]
>[0];

/** A command this pipeline appends into, as the registered graph exposes it. */
type WorkerCommandSender = { send(data: unknown): Promise<void> };

/** Langy conversations' worker-facing capability after its graph is composed. */
export interface LangyConversationWorkerCapability<
  TFailAgentResponse = unknown,
  TGenerateConversationTitle = unknown,
> {
  /**
   * Builds the conversation definition: the conversation aggregate, its two
   * Postgres folds, the per-message and analytics map projections, the turn
   * process manager and the three live subscribers. Every port the effects
   * need is already bound by the composition root.
   */
  buildProcessing(): WorkerPipelineDefinition;
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
export class LangyConversationWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: LangyConversationWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): LangyConversationWorkerFeatureInstaller {
    return new LangyConversationWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "langy-conversation";
  private installed = false;

  private constructor(
    private readonly installer: LangyConversationWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, WorkerCommandSender>;
      const failAgentResponse = commands.failAgentResponse;
      const generateConversationTitle = commands.generateConversationTitle;
      if (!failAgentResponse || !generateConversationTitle) {
        throw new Error(
          "Langy conversation pipeline must register failAgentResponse and generateConversationTitle commands.",
        );
      }
      this.installer.connectCommands({
        failAgentResponse: (data) => failAgentResponse.send(data),
        generateConversationTitle: (data) => generateConversationTitle.send(data),
      });
      this.installed = true;
    }
    return LangyConversationWorkerFeatureHandle.create();
  }
}

class LangyConversationWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): LangyConversationWorkerFeatureHandle {
    return new LangyConversationWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
