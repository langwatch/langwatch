import {
  TraceNotFoundError,
  type TraceByIdInput,
  type TraceFullReadInput,
  type TraceFullRecord,
  type TraceFullThreadReadInput,
} from "@langwatch/trace-contract";

import { type TraceEventDerivation } from "../../app/trace.members.ts";
import { TraceFullRecordRepository } from "../../repositories/trace-full-record.repository.ts";
import { TraceRecordRepository } from "../../repositories/trace-record.repository.ts";

class MissingTraceRecords extends TraceRecordRepository {
  async getById(input: TraceByIdInput): Promise<never> {
    throw new TraceNotFoundError(input.traceId);
  }
}

class EmptyTraceEvents implements TraceEventDerivation {
  async derive(): Promise<[]> {
    return [];
  }
}

class MissingFullTraceRecords extends TraceFullRecordRepository {
  async get(input: TraceFullReadInput): Promise<TraceFullRecord> {
    throw new TraceNotFoundError(input.traceId);
  }

  async findThread(_input: TraceFullThreadReadInput): Promise<[]> {
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
