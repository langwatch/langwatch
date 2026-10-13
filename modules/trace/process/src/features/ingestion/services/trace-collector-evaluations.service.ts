import type { EventingCommandSender } from "@langwatch/eventing";
import { TraceCapabilityUnavailableError } from "@langwatch/trace-contract";

import {
  type RecordCollectorEvaluationCommandData,
  recordCollectorEvaluationCommandDataSchema,
} from "../eventing/trace-collector-evaluations.events.ts";

type TraceCollectorEvaluationsSenders = Readonly<{
  recordCollectorEvaluation: Pick<
    EventingCommandSender<RecordCollectorEvaluationCommandData>,
    "send"
  >;
}>;

/** Records collector evaluations on trace's own pipeline; unbound, it refuses by name. */
export class TraceCollectorEvaluationsService {
  static create(input: { role: string }): TraceCollectorEvaluationsService {
    return new TraceCollectorEvaluationsService(input.role);
  }

  #senders: TraceCollectorEvaluationsSenders | undefined;

  private constructor(private readonly role: string) {}

  connect(senders: TraceCollectorEvaluationsSenders): void {
    this.#senders = senders;
  }

  /** Parsed rather than cast, so a differently-spelled field is refused here, not downstream. */
  async record(data: unknown): Promise<void> {
    await this.#connected().recordCollectorEvaluation.send(
      recordCollectorEvaluationCommandDataSchema.parse(data),
    );
  }

  #connected(): TraceCollectorEvaluationsSenders {
    if (!this.#senders) {
      throw new TraceCapabilityUnavailableError(
        this.role,
        "the trace_collector_evaluations commands",
      );
    }
    return this.#senders;
  }
}
