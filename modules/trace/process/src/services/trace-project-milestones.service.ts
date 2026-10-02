import type { EventingCommandSender } from "@langwatch/eventing";
import { TraceCapabilityUnavailableError } from "@langwatch/trace-contract";

import type {
  RecordFirstTraceCommandData,
  RecordTraceReceivedCommandData,
} from "../eventing/trace-project-milestones.events.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send">;

type TraceProjectMilestonesSenders = Readonly<{
  recordFirstTrace: Sender<RecordFirstTraceCommandData>;
  recordTraceReceived: Sender<RecordTraceReceivedCommandData>;
}>;

/** Records a project's trace milestones on trace's own pipeline; unbound, each refuses by name. */
export class TraceProjectMilestonesService {
  static create(input: { processName: string }): TraceProjectMilestonesService {
    return new TraceProjectMilestonesService(input.processName);
  }

  #senders: TraceProjectMilestonesSenders | undefined;

  private constructor(private readonly processName: string) {}

  connect(senders: TraceProjectMilestonesSenders): void {
    this.#senders = senders;
  }

  async recordFirstTrace(data: RecordFirstTraceCommandData): Promise<void> {
    await this.#connected().recordFirstTrace.send(data);
  }

  async recordTraceReceived(data: RecordTraceReceivedCommandData): Promise<void> {
    await this.#connected().recordTraceReceived.send(data);
  }

  #connected(): TraceProjectMilestonesSenders {
    if (!this.#senders) {
      throw new TraceCapabilityUnavailableError(
        this.processName,
        "the trace_project_milestones commands",
      );
    }
    return this.#senders;
  }
}
