import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import type { NormalizedSpan } from "@langwatch/trace-contract";
import {
  TraceIoExtractionPort,
  type TraceIoSide,
  type TraceIoValue,
} from "../ports/trace-io-extraction.port";
import { TraceIOExtractionService } from "../services/trace-io-extraction.service";

/**
 * The projection's input/output extraction, over this package's own service.
 */
export class TraceIoExtractionAdapter extends TraceIoExtractionPort {
  private constructor(private readonly service: TraceIOExtractionService) {
    super();
  }

  static create(canonicalisation: TraceCanonicalisationService): TraceIoExtractionAdapter {
    return new TraceIoExtractionAdapter(TraceIOExtractionService.create(canonicalisation));
  }

  static fromService(service: TraceIOExtractionService): TraceIoExtractionAdapter {
    return new TraceIoExtractionAdapter(service);
  }

  tryExtractRichIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null {
    return this.service.extractRichIOFromSpan(span, side);
  }

  tryExtractFallbackIOFromSpan(span: NormalizedSpan, side: TraceIoSide): TraceIoValue | null {
    return this.service.extractFallbackIOFromSpan(span, side);
  }
}
