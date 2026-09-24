import type { EventingCommands } from "@langwatch/eventing";
import {
  TraceCapabilityUnavailableError,
  type AssignTopicCommandData,
  type RecordSpanCommandData,
  type ResolveOriginCommandData,
} from "@langwatch/trace-contract";

import type {
  TraceProcessingCommands,
  TraceProcessingPipelineDefinition,
} from "../app/trace.members.ts";

type TraceProcessingSenders = EventingCommands<TraceProcessingPipelineDefinition>;
type Payload<Name extends keyof TraceProcessingSenders> = Parameters<
  TraceProcessingSenders[Name]["send"]
>[0];

/** trace_processing's senders, bound on connect; unbound, each refuses by name. */
export class TraceProcessingCommandsService implements TraceProcessingCommands {
  static create(input: { processName: string }): TraceProcessingCommandsService {
    return new TraceProcessingCommandsService(input.processName);
  }

  #senders: TraceProcessingSenders | undefined;

  private constructor(private readonly processName: string) {}

  connect(senders: TraceProcessingSenders): void {
    this.#senders = senders;
  }

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    await this.#connected("recordSpan").recordSpan.send(data);
  }

  async changeTraceName(data: Payload<"changeTraceName">): Promise<void> {
    await this.#connected("changeTraceName").changeTraceName.send(data);
  }

  async addAnnotation(data: Payload<"addAnnotation">): Promise<void> {
    await this.#connected("addAnnotation").addAnnotation.send(data);
  }

  async removeAnnotation(data: Payload<"removeAnnotation">): Promise<void> {
    await this.#connected("removeAnnotation").removeAnnotation.send(data);
  }

  async assignTopic(data: AssignTopicCommandData): Promise<void> {
    await this.#connected("assignTopic").assignTopic.send(data);
  }

  async resolveOrigin(data: ResolveOriginCommandData): Promise<void> {
    await this.#connected("resolveOrigin").resolveOrigin.send(data);
  }

  #connected(command: string): TraceProcessingSenders {
    if (!this.#senders) {
      throw new TraceCapabilityUnavailableError(
        this.processName,
        `the trace_processing "${command}" command`,
      );
    }
    return this.#senders;
  }
}
