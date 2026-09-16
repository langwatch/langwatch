import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import {
  type TraceIoExtraction,
  type TraceIoSide,
  type TraceIoValue,
} from "../app/trace.members.ts";
import { TraceIOExtractionService } from "./trace-io-extraction.service.ts";

/**
 * The projection's input/output extraction, over this package's own service.
 */
export class TraceIoExtractionAdapter implements TraceIoExtraction {
  private constructor(private readonly service: TraceIOExtractionService) {
  }

  static create(canonicalisation: TraceCanonicalisationService): TraceIoExtractionAdapter {
    return new TraceIoExtractionAdapter(TraceIOExtractionService.create(canonicalisation));
  }

  static fromService(service: TraceIOExtractionService): TraceIoExtractionAdapter {
    return new TraceIoExtractionAdapter(service);
  }

  extractRichIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null {
    return this.service.extractRichIOFromSpan(span, side);
  }

  extractFallbackIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null {
    return this.service.extractFallbackIOFromSpan(span, side);
  }
}
