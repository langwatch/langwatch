import type { CommandEnvelope, EventingCommandSender } from "@langwatch/eventing";
import {
  TraceCapabilityUnavailableError,
  type AnnotationAddedEventData,
  type AnnotationRemovedEventData,
  type AssignTopicCommandData,
  type LogTraceContribution,
  type RecordMetricCorrelationCommandData,
  type RecordSpanCommandData,
  type ResolveOriginCommandData,
  type TraceNameChangedEventData,
} from "@langwatch/trace-contract";

/** Commands shared by receiver, reviewer, and background callers of Trace. */
export interface TraceProcessingCommands {
  recordSpan(data: RecordSpanCommandData): Promise<unknown>;
  changeTraceName(data: TraceNameChangedEventData): Promise<unknown>;
  addAnnotation(data: AnnotationAddedEventData): Promise<unknown>;
  removeAnnotation(data: AnnotationRemovedEventData): Promise<unknown>;
  assignTopic(data: AssignTopicCommandData): Promise<unknown>;
}

/** The trace_processing command senders this service dispatches through, and nothing else. */
type TraceProcessingSenders = Readonly<{
  recordSpan: EventingCommandSender<RecordSpanCommandData>;
  changeTraceName: EventingCommandSender<TraceNameChangedEventData & CommandEnvelope>;
  addAnnotation: EventingCommandSender<AnnotationAddedEventData & CommandEnvelope>;
  removeAnnotation: EventingCommandSender<AnnotationRemovedEventData & CommandEnvelope>;
  assignTopic: EventingCommandSender<AssignTopicCommandData>;
  resolveOrigin: EventingCommandSender<ResolveOriginCommandData>;
  recordLogContribution: EventingCommandSender<LogTraceContribution>;
  recordMetricCorrelation: EventingCommandSender<RecordMetricCorrelationCommandData>;
}>;

/** trace_processing's senders, bound on connect; unbound, each refuses by name. */
export class TraceProcessingCommandsService implements TraceProcessingCommands {
  static create(input: { role: string }): TraceProcessingCommandsService {
    return new TraceProcessingCommandsService(input.role);
  }

  #senders: TraceProcessingSenders | undefined;

  private constructor(private readonly role: string) {}

  connect(senders: TraceProcessingSenders): void {
    this.#senders = senders;
  }

  async recordSpan(data: RecordSpanCommandData): Promise<void> {
    await this.#connected("recordSpan").recordSpan.send(data);
  }

  async changeTraceName(data: TraceNameChangedEventData & CommandEnvelope): Promise<void> {
    await this.#connected("changeTraceName").changeTraceName.send(data);
  }

  async addAnnotation(data: AnnotationAddedEventData & CommandEnvelope): Promise<void> {
    await this.#connected("addAnnotation").addAnnotation.send(data);
  }

  async removeAnnotation(data: AnnotationRemovedEventData & CommandEnvelope): Promise<void> {
    await this.#connected("removeAnnotation").removeAnnotation.send(data);
  }

  async assignTopic(data: AssignTopicCommandData): Promise<void> {
    await this.#connected("assignTopic").assignTopic.send(data);
  }

  async resolveOrigin(data: ResolveOriginCommandData): Promise<void> {
    await this.#connected("resolveOrigin").resolveOrigin.send(data);
  }

  async recordLogContributions(data: LogTraceContribution[]): Promise<void> {
    await this.#connected("recordLogContribution").recordLogContribution.sendBatch(data);
  }

  async recordMetricCorrelations(data: RecordMetricCorrelationCommandData[]): Promise<void> {
    await this.#connected("recordMetricCorrelation").recordMetricCorrelation.sendBatch(data);
  }

  #connected(command: string): TraceProcessingSenders {
    if (!this.#senders) {
      throw new TraceCapabilityUnavailableError(
        this.role,
        `the trace_processing "${command}" command`,
      );
    }
    return this.#senders;
  }
}
