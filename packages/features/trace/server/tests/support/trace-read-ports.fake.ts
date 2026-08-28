import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceFullReadInput,
  type TraceFullRecord,
  type TraceFullThreadReadInput,
} from "@langwatch/trace-contract";
import { TraceEventDerivationPort } from "../../src/ports/trace-event-derivation.port";
import { TraceFullRecordPort } from "../../src/ports/trace-full-record.port";
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

class MissingFullTraceRecords extends TraceFullRecordPort {
  async get(input: TraceFullReadInput): Promise<TraceFullRecord> {
    throw new TraceNotFoundError(input.traceId);
  }

  async getThread(_input: TraceFullThreadReadInput): Promise<[]> {
    return [];
  }
}

export function traceReadPorts() {
  return {
    records: new MissingTraceRecords(),
    eventDerivation: new EmptyTraceEvents(),
    fullRecords: new MissingFullTraceRecords(),
  };
}
