import {
  type NormalizedSpan,
  type TraceRecordValue,
  traceRecordValueSchema,
} from "@langwatch/trace-contract";

import type { TraceIOExtractionService } from "./trace-io-extraction.service.ts";

export type TraceFullIoRecord = {
  input: { type: string; value: TraceRecordValue } | null;
  output: { type: string; value: TraceRecordValue } | null;
};

/** Recomputes a full trace's first input and last output from its spans. */
export interface TraceFullIo {
  recompute(spans: NormalizedSpan[]): TraceFullIoRecord;
}

/** The full record's input and output, read off the first input and last output span. */
export class TraceReadFullIoService implements TraceFullIo {
  static create(extraction: TraceIOExtractionService): TraceReadFullIoService {
    return new TraceReadFullIoService(extraction);
  }

  #extraction: TraceIOExtractionService;

  private constructor(extraction: TraceIOExtractionService) {
    this.#extraction = extraction;
  }

  recompute(spans: NormalizedSpan[]): TraceFullIoRecord {
    const input = this.#extraction.extractFirstInput(spans);
    const output = this.#extraction.extractLastOutput(spans);
    return {
      input: input ? { type: "json", value: traceRecordValueSchema.parse(input.raw) } : null,
      output: output ? { type: "json", value: traceRecordValueSchema.parse(output.raw) } : null,
    };
  }
}
