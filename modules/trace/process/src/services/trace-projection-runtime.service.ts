import type { TraceCanonicalisationService } from "@langwatch/trace-contract";

import { TraceAttributeAccumulationService } from "../features/derivation/services/trace-attribute-accumulation.service.ts";
import { TraceIOAccumulationService } from "../features/derivation/services/trace-io-accumulation.service.ts";
import type { TraceIoExtraction } from "../features/derivation/services/trace-io-extraction.service.ts";
import type { TraceModelCost } from "../features/derivation/services/trace-model-cost.service.ts";
import { TraceNameResolutionService } from "../features/derivation/services/trace-name-resolution.service.ts";
import { TracePromptAccumulationService } from "../features/derivation/services/trace-prompt-accumulation.service.ts";
import type { TraceMediaReferenceResolver } from "../features/media/services/trace-media-reference.service.ts";
import { SpanCostService } from "../features/span/services/span-cost.service.ts";
import type { TraceSpanNormalization } from "../features/span/services/span-normalization.service.ts";
import { SpanStatusService } from "../features/span/services/span-status.service.ts";
import { SpanTimingService } from "../features/span/services/span-timing.service.ts";
import { TraceOriginService } from "./trace-origin.service.ts";

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
  readonly spanNormalization: TraceSpanNormalization;

  private constructor(options: {
    canonicalisation: TraceCanonicalisationService;
    ioExtraction: TraceIoExtraction;
    mediaReferences: TraceMediaReferenceResolver;
    modelCosts: TraceModelCost;
    spanNormalization: TraceSpanNormalization;
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
    ioExtraction: TraceIoExtraction;
    mediaReferences: TraceMediaReferenceResolver;
    modelCosts: TraceModelCost;
    spanNormalization: TraceSpanNormalization;
  }): TraceProjectionRuntimeService {
    return new TraceProjectionRuntimeService(options);
  }
}
