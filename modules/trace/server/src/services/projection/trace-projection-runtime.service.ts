import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import { TraceIoExtraction } from "../../app/trace.members.ts";
import { TraceMediaReferenceResolver } from "../../app/trace.members.ts";
import { TraceModelCost } from "../../app/trace.members.ts";
import { TraceSpanNormalization } from "../../app/trace.members.ts";
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
