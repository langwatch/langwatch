import type { RecordSpanCommandData } from "@langwatch/trace-contract";

import {
  TraceEdgeMediaExtractionService,
  type EdgeMediaExtractionDeps,
  type EdgeMediaExtractionLogger,
} from "./trace-edge-media-extraction.service.ts";
import { TraceIngressPayloadPort } from "./trace-ingestion.service.ts";

// Extraction runs FIRST, which is why `next` is a member here rather than an
// ordering a composition root remembers: externalizing the heavy part usually
// brings the command back under `COMMAND_INLINE_THRESHOLD`, so the ADR-022
// whole-payload spool behind it rarely fires and the queue stays light.

/**
 * Edge media extraction as the ingest path's payload preparation. Fail-open in
 * both halves: extraction returns the span unchanged on any failure, and
 * whatever follows sees exactly what it would have seen.
 */
export class TraceEdgeMediaPayloadService extends TraceIngressPayloadPort {
  static create(options: {
    deps: EdgeMediaExtractionDeps;
    logger: EdgeMediaExtractionLogger;
    /** The preparation this one runs before, when the process composed one. */
    next?: TraceIngressPayloadPort;
  }): TraceEdgeMediaPayloadService {
    return new TraceEdgeMediaPayloadService(options);
  }

  private constructor(
    private readonly options: {
      deps: EdgeMediaExtractionDeps;
      logger: EdgeMediaExtractionLogger;
      next?: TraceIngressPayloadPort;
    },
  ) {
    super();
  }

  async prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    const extracted = await TraceEdgeMediaExtractionService.maybeExtractSpanMedia({
      data,
      deps: this.options.deps,
      logger: this.options.logger,
    });

    return this.options.next ? await this.options.next.prepare(extracted) : extracted;
  }
}
