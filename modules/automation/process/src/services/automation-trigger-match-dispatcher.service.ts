import type { EventingCommands } from "@langwatch/eventing";

import type { AutomationTriggerMatchRecorder } from "../app/automation.members.ts";
import type { AutomationsPipeline } from "../eventing/automation.pipeline.ts";

/**
 * The `automations` pipeline's own recordTriggerMatch sender, which exists only
 * once the pipeline is registered. A process that hosts none refuses by name
 * rather than failing on an undefined sender.
 */
export class AutomationTriggerMatchDispatcherService implements AutomationTriggerMatchRecorder {
  #commands: EventingCommands<AutomationsPipeline> | undefined;

  private constructor() {}

  static create(): AutomationTriggerMatchDispatcherService {
    return new AutomationTriggerMatchDispatcherService();
  }

  /** Binds the registered pipeline's senders. Called once, by the eventing module. */
  connect(commands: EventingCommands<AutomationsPipeline>): void {
    this.#commands = commands;
  }

  async send(input: Parameters<AutomationTriggerMatchRecorder["send"]>[0]): Promise<void> {
    if (!this.#commands) {
      throw new Error(
        "automations registered no recordTriggerMatch sender; this process hosts no automations pipeline",
      );
    }

    await this.#commands.recordTriggerMatch.send(input);
  }
}
