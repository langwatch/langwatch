import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { TraceIoExtractionPort } from "../ports/trace-io-extraction.port";
import { TraceMediaReferencePort } from "../ports/trace-media-reference.port";
import { TraceModelCostPort } from "../ports/trace-model-cost.port";
import { TraceSpanNormalizationPort } from "../ports/trace-span-normalization.port";
import { SpanCostService } from "./span-cost.service";
import { SpanStatusService } from "./span-status.service";
import { SpanTimingService } from "./span-timing.service";
import { TraceAttributeAccumulationService } from "./trace-attribute-accumulation.service";
import { TraceIOAccumulationService } from "./trace-io-accumulation.service";
import { TraceNameResolutionService } from "./trace-name-resolution.service";
import { TraceOriginService } from "./trace-origin.service";
import { TracePromptAccumulationService } from "./trace-prompt-accumulation.service";

/**
 * The deterministic collaborators shared by Trace's three event projections.
 * Technical extraction, media and pricing ports enter once at process
 * composition; projections never reach into the application to obtain them.
 */
export class TraceProjectionRuntimeService {
  readonly spanTiming: SpanTimingService;
  readonly spanStatus: SpanStatusService;
  readonly traceOrigin: TraceOriginService;
  readonly traceAttributes: TraceAttributeAccumulationService;
  readonly tracePrompt: TracePromptAccumulationService;
  readonly traceName: TraceNameResolutionService;
  readonly spanCost: SpanCostService;
  readonly traceIo: TraceIOAccumulationService;
  readonly spanNormalization: TraceSpanNormalizationPort;

  private constructor(options: {
    canonicalisation: TraceCanonicalisationService;
    ioExtraction: TraceIoExtractionPort;
    mediaReferences: TraceMediaReferencePort;
    modelCosts: TraceModelCostPort;
    spanNormalization: TraceSpanNormalizationPort;
  }) {
    this.spanTiming = SpanTimingService.create();
    this.spanStatus = SpanStatusService.create();
    this.traceOrigin = TraceOriginService.create();
    this.traceAttributes = TraceAttributeAccumulationService.create(this.traceOrigin);
    this.tracePrompt = TracePromptAccumulationService.create();
    this.traceName = TraceNameResolutionService.create();
    this.spanCost = SpanCostService.create({ modelCosts: options.modelCosts });
    this.traceIo = TraceIOAccumulationService.create(
      options.ioExtraction,
      options.canonicalisation,
      options.mediaReferences,
    );
    this.spanNormalization = options.spanNormalization;
  }

  static create(options: {
    canonicalisation: TraceCanonicalisationService;
    ioExtraction: TraceIoExtractionPort;
    mediaReferences: TraceMediaReferencePort;
    modelCosts: TraceModelCostPort;
    spanNormalization: TraceSpanNormalizationPort;
  }): TraceProjectionRuntimeService {
    return new TraceProjectionRuntimeService(options);
  }
}
