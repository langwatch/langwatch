import type { RecordSpanCommandData } from "@langwatch/trace-contract";

import { TraceIngressPayload } from "../../ingestion/services/trace-span-collection.service.ts";
import type { TraceEdgeMediaTelemetry } from "./trace-edge-media-telemetry.service.ts";
import { TraceMediaExtractionService } from "./trace-media-extraction.service.ts";
import type { TraceMediaStore } from "./trace-media-store.service.ts";
import {
  type EdgeMediaExtractionLogger,
  type EdgeMediaExtractionPolicy,
  TraceSpanMediaExtractionService,
} from "./trace-span-media-extraction.service.ts";

// Extraction runs FIRST, which is why `next` is a member here rather than an
// ordering a composition root remembers: externalizing the heavy part usually
// brings the command back under `COMMAND_INLINE_THRESHOLD`, so the ADR-022
// whole-payload spool behind it rarely fires and the queue stays light.

/** The policy, counters and store the ingest path's media extraction runs with. */
export type EdgeMediaExtractionDeps = EdgeMediaExtractionPolicy &
  Readonly<{ telemetry: TraceEdgeMediaTelemetry; store: TraceMediaStore }>;

/**
 * Edge media extraction as the ingest path's payload preparation. Fail-open in
 * both halves: extraction returns the span unchanged on any failure, and
 * whatever follows sees exactly what it would have seen.
 */
export class TraceEdgeMediaPayloadService extends TraceIngressPayload {
  static create(options: {
    deps: EdgeMediaExtractionDeps;
    logger: EdgeMediaExtractionLogger;
    /** The preparation this one runs before, when the process composed one. */
    next?: TraceIngressPayload;
  }): TraceEdgeMediaPayloadService {
    return new TraceEdgeMediaPayloadService(
      TraceSpanMediaExtractionService.create({
        extraction: TraceMediaExtractionService.create({ store: options.deps.store }),
        telemetry: options.deps.telemetry,
        logger: options.logger,
      }),
      options.deps,
      options.next,
    );
  }

  private constructor(
    private readonly extraction: TraceSpanMediaExtractionService,
    private readonly policy: EdgeMediaExtractionPolicy,
    private readonly next: TraceIngressPayload | undefined,
  ) {
    super();
  }

  async prepare(data: RecordSpanCommandData): Promise<RecordSpanCommandData> {
    const extracted = await this.extraction.extractFromSpan({ data, policy: this.policy });

    return this.next ? this.next.prepare(extracted) : extracted;
  }
}
