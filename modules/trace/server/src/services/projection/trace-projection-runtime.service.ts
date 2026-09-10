import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { TraceIoExtractionPort } from "../../ports/trace-io-extraction.port.ts";
import { TraceMediaReferencePort } from "../../ports/trace-media-reference.port.ts";
import { TraceModelCostPort } from "../../ports/trace-model-cost.port.ts";
import { TraceSpanNormalizationPort } from "../../ports/trace-span-normalization.port.ts";
import { SpanCostService } from "../span/span-cost.service.ts";
import { SpanStatusService } from "../span/span-status.service.ts";
import { SpanTimingService } from "../span/span-timing.service.ts";
import { TraceAttributeAccumulationService } from "../attribute/trace-attribute-accumulation.service.ts";
import { TraceIOAccumulationService } from "../content/trace-io-accumulation.service.ts";
import { TraceNameResolutionService } from "../support/trace-name-resolution.service.ts";
import { TraceOriginService } from "../read/trace-origin.service.ts";
import { TracePromptAccumulationService } from "../content/trace-prompt-accumulation.service.ts";

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
