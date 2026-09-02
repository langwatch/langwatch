import type { DataPrivacyService } from "@langwatch/data-privacy-contract";
import { OtlpSpanContentDropService } from "@langwatch/data-privacy-server";
import type { OtlpSpan } from "@langwatch/trace-contract";
import { TraceSpanContentDropPort, type TraceSpanContentDropResult } from "@langwatch/trace-server";

/**
 * The content this process would refuse to store for a project that asked for
 * a category to be dropped.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand`'s adapters and still drops content on every span it
 * ingests — so nothing in this process drops anything yet. What has to be true
 * today is that this composition root CAN build the path from what it already
 * holds: the scoped data-privacy service and the enforcement flag it already
 * reads for redaction. That is the whole dependency list.
 *
 *     TraceSpanContentDropPort             (trace-server declares it)
 *       └─ OtlpSpanContentDropService      (data-privacy-server owns it)
 *            ├─ ContentDropPolicyService   policy → keys, roles, matchers
 *            ├─ CONTENT_KEY_CATALOG        (data-privacy-contract owns it)
 *            └─ DataPrivacyService         resolves the scope's policy
 *
 * SEPARATE FROM THE REDACTION COMPOSITION ON PURPOSE, even though both rest on
 * the same policy source: a drop removes a whole attribute and a redaction
 * rewrites one, they fail independently, and a process that can resolve a
 * policy but has no analysis transport should still be able to honour a
 * customer's `drop`.
 */
export function createWorkerTraceContentDrop(options: {
  dataPrivacy: DataPrivacyService;
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

  /** The narrow port `RecordSpanCommand` names, over this graph. */
  spanContentDropPort(): TraceSpanContentDropPort {
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
class WorkerTraceSpanContentDropAdapter extends TraceSpanContentDropPort {
  constructor(private readonly service: OtlpSpanContentDropService) {
    super();
  }

  async drop(span: OtlpSpan, projectId: string): Promise<TraceSpanContentDropResult> {
    return await this.service.dropSpanContent({ span, projectId });
  }
}
