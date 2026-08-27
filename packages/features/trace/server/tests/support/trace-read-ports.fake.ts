import { TraceNotFoundError, type TraceByIdInput } from "@langwatch/trace-contract";
import { TraceEventDerivationPort } from "../../src/ports/trace-event-derivation.port";
import { TraceRecordPort } from "../../src/ports/trace-record.port";

class MissingTraceRecords extends TraceRecordPort {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

class EmptyTraceEvents extends TraceEventDerivationPort {
  async derive(): Promise<[]> {
    return [];
  }
}

export function traceReadPorts() {
  return {
    records: new MissingTraceRecords(),
    eventDerivation: new EmptyTraceEvents(),
  };
}
