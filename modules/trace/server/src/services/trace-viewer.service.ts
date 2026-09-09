import {
  type Trace,
  TraceViewerService,
  type TraceViewerReadInput,
} from "@langwatch/trace-contract";
import type { TraceLegacyReadPort } from "../ports/trace-legacy-read.port.ts";
import type { TraceViewerProtectionService } from "./trace-viewer-protection.service.ts";

export type TraceViewerServiceOptions = Readonly<{
  read: TraceLegacyReadPort;
  protections: TraceViewerProtectionService;
}>;

/**
 * The complete named viewer read. It owns the viewer identity-to-protections
 * boundary and delegates hydration to the existing trace read pipeline, so
 * blobs, spans, coding-agent enrichment and ordering retain one implementation.
 */
export class TraceViewerReadService extends TraceViewerService {
  static create(options: TraceViewerServiceOptions): TraceViewerReadService {
    return new TraceViewerReadService(options);
  }

  private constructor(private readonly options: TraceViewerServiceOptions) {
    super();
  }

  async readForViewer(input: TraceViewerReadInput): Promise<Trace[]> {
    const protections = await this.options.protections.resolve({
      projectId: input.projectId,
      userId: input.userId,
      publiclyShared: false,
    });

    return this.options.read.getTracesWithSpans(
      input.projectId,
      [...input.traceIds],
      protections,
      void 0,
      { full: true },
    );
  }
}
