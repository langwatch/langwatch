import type { EventingCommandSender } from "@langwatch/eventing";

import type { RecordCodingAgentSessionStoredCommandData } from "../eventing/coding-agent-project-milestones.events.ts";
import type { CodingAgentSessionStoredRecorder } from "./coding-agent-session-facts.service.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send">;

/** Records a project's coding-agent milestones on its own pipeline; unbound, it refuses by name. */
export class CodingAgentProjectMilestonesService implements CodingAgentSessionStoredRecorder {
  static create(): CodingAgentProjectMilestonesService {
    return new CodingAgentProjectMilestonesService();
  }

  #recordSessionStored: Sender<RecordCodingAgentSessionStoredCommandData> | undefined;

  private constructor() {}

  connect(senders: {
    recordSessionStored: Sender<RecordCodingAgentSessionStoredCommandData>;
  }): void {
    this.#recordSessionStored = senders.recordSessionStored;
  }

  async recordSessionStored(data: RecordCodingAgentSessionStoredCommandData): Promise<void> {
    if (!this.#recordSessionStored) {
      throw new Error(
        "coding_agent_project_milestones registered no sender; this process hosts no such pipeline",
      );
    }
    await this.#recordSessionStored.send(data);
  }
}
