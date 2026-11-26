import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";

import { TRACE_CONTENT_MEDIA } from "./trace-media-store.service.ts";

/** One project's pass: how many objects it saw and how many it linked. */
export type TraceMediaOwnerLinkOutcome = {
  status: "finalized";
  report: { kind: string; scanned: number; linked: number };
};

/** The project's trace retention changed during the pass, so its new links may end too early. */
export class TraceMediaRetentionChangedError extends Error {
  constructor({ tenantId, before, after }: { tenantId: string; before: number; after: number }) {
    super(
      `trace retention of ${tenantId} changed from ${before} to ${after} days while its media ` +
        "was linked; apply the project's trace retention to existing data again, then retry",
    );
    this.name = "TraceMediaRetentionChangedError";
  }
}

/**
 * Trace media stored before Stored Objects kept owner links holds none, so its sweep never
 * deletes it. Per project, this links each such object to its trace until the project's trace
 * retention ends, counted from the object's creation (stored-object ADR-002 Consequences).
 */
export class TraceMediaOwnerLinkBackfillService {
  static create({
    storedObjects,
    retention,
  }: {
    storedObjects: Pick<StoredObjectApi, "linkUnownedObjects">;
    retention: Pick<DataRetentionApi, "getRetentionDays">;
  }): TraceMediaOwnerLinkBackfillService {
    return new TraceMediaOwnerLinkBackfillService(storedObjects, retention);
  }

  private constructor(
    private readonly storedObjects: Pick<StoredObjectApi, "linkUnownedObjects">,
    private readonly retention: Pick<DataRetentionApi, "getRetentionDays">,
  ) {}

  async linkProject({
    tenantId,
    signal,
  }: {
    tenantId: string;
    signal?: AbortSignal;
  }): Promise<TraceMediaOwnerLinkOutcome> {
    signal?.throwIfAborted();
    const retentionDays = await this.traceRetentionOf(tenantId);
    const counts = await this.storedObjects.linkUnownedObjects({
      projectId: tenantId,
      purpose: TRACE_CONTENT_MEDIA.purpose,
      retentionDays,
    });
    // A change whose follow ran mid-pass never reaches the links written after it.
    const after = await this.traceRetentionOf(tenantId);
    if (after !== retentionDays) {
      throw new TraceMediaRetentionChangedError({ tenantId, before: retentionDays, after });
    }

    return {
      status: "finalized",
      report: { kind: "trace_media_owner_links_backfilled", ...counts },
    };
  }

  private traceRetentionOf(projectId: string): Promise<number> {
    return this.retention.getRetentionDays({ projectId, category: "traces" });
  }
}
