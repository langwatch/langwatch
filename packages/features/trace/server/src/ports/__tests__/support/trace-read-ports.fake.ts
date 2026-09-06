import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceFullReadInput,
  type TraceFullRecord,
  type TraceFullThreadReadInput,
} from "@langwatch/trace-contract";
import { TraceEventDerivationPort } from "../../trace-event-derivation.port.ts";
import { TraceFullRecordPort } from "../../trace-full-record.port.ts";
import { TraceRecordPort } from "../../trace-record.port.ts";

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
