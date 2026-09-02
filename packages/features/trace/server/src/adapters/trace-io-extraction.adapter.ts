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
 *
 * Frozen twin of the application's `AppTraceIoExtractionAdapter`
 * (`platform/app/src/runtime/app/trace-projections.adapter.ts`), and the same
 * two-line rename: the port's `tryExtract*` names say a miss is expected and
 * returns null, while the service's `extract*` names read as if they always
 * answer. The rename is the whole adapter — no behaviour sits here.
 *
 * `fromService` exists for the one caller that already holds an extraction
 * service and must not build a second: the trace-summary IO accumulation
 * composes over the same instance the pipeline runs, so a trace's headline IO
 * and its per-span IO are read by one walk rather than two.
 */
export class TraceIoExtractionAdapter extends TraceIoExtractionPort {
  private constructor(private readonly service: TraceIOExtractionService) {
    super();
  }

  static create(canonicalisation: TraceCanonicalisationService): TraceIoExtractionAdapter {
    return new TraceIoExtractionAdapter(new TraceIOExtractionService(canonicalisation));
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
