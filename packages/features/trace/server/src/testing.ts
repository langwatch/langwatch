import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceDerivedEventsInput,
} from "@langwatch/trace-contract";
import { TraceEventDerivationPort } from "./ports/trace-event-derivation.port";
import { TraceQueryClassificationPort } from "./ports/trace-query-classification.port";
import { TraceRecordPort } from "./ports/trace-record.port";
import { TraceSummaryReaderPort } from "./ports/trace-summary-reader.port";

export { TraceCanonicalisationService } from "./services/trace-canonicalisation.service";

export class MissingTraceRecordPort extends TraceRecordPort {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

export class EmptyTraceEventDerivationPort extends TraceEventDerivationPort {
  async derive(_input: TraceDerivedEventsInput): Promise<[]> {
    return [];
  }
}

export class EmptyTraceSummaryReaderPort extends TraceSummaryReaderPort {
  async tryGetSummary(): Promise<null> {
    return null;
  }
}

export class EmptyTraceQueryClassificationPort extends TraceQueryClassificationPort {
  classify() {
    return { evaluations: false, events: false, spans: false };
  }
}
