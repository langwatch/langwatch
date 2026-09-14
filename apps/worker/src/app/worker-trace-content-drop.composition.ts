import {
  OtlpSpanContentDropService,
  type DataPrivacyResolution,
} from "@langwatch/data-privacy-server";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { type TraceSpanContentDrop, type TraceSpanContentDropResult } from "@langwatch/trace-server";

/**
 * Staged but not mounted; builds the content-drop path from data-privacy
 * resolution.
 */
export function createWorkerTraceContentDrop(options: {
  /**
   * The port, not the whole DataPrivacyService; drop reads policy only.
   */
  dataPrivacy: DataPrivacyResolution;
  nativePolicyEnforced: boolean;
}): WorkerTraceContentDrop {
  return new WorkerTraceContentDrop(
    OtlpSpanContentDropService.create({
      dataPrivacy: options.dataPrivacy,
      nativePolicyEnforced: options.nativePolicyEnforced,
    }),
  );
}

/** One process-owned drop graph. */
export class WorkerTraceContentDrop {
  constructor(private readonly drop: OtlpSpanContentDropService) {}

  /** The narrow port `EventingRecordSpanAdapter` names, over this graph. */
  spanContentDropPort(): TraceSpanContentDrop {
    return new WorkerTraceSpanContentDropAdapter(this.drop);
  }
}

/**
 * Renames `dropSpanContent` onto the port Trace declares.
 *
 * The service is not a subclass of the port and must not become one: the drop
 * belongs to data privacy, which owes the same answer to the log and metric
 * ingestion paths when they convert, and a service extending one feature's
 * port could not answer the others'.
 */
class WorkerTraceSpanContentDropAdapter implements TraceSpanContentDrop {
  constructor(private readonly service: OtlpSpanContentDropService) {}

  async drop(span: OtlpSpan, projectId: string): Promise<TraceSpanContentDropResult> {
    return await this.service.dropSpanContent({ span, projectId });
  }
}
