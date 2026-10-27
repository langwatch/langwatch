import type { Logger } from "@langwatch/observability";

import type { TraceLegacySpool } from "../../../channels/trace-legacy-spool.channel.ts";
import type {
  OffloadRecallOutcome,
  TracePayloadReaderRepository,
} from "../../../repositories/trace-payload-reader.repository.ts";
import type {
  TraceSpoolDestinationKind,
  TraceSpoolObjectAddress,
  TraceSpoolObjectsRepository,
} from "../../../repositories/trace-spool-objects.repository.ts";
import {
  type OffloadedFieldReference,
  offloadedFieldKey,
} from "../../../rules/trace-offload-recall.rules.ts";
import { TraceStreamBufferService } from "../../../services/trace-stream-buffer.service.ts";
import {
  assertLegacySpoolKeyBelongsTo,
  buildSpoolObjectPath,
  isLegacySpoolRef,
  SPOOL_REF_V2,
} from "../../ingestion/rules/trace-spool-location.rules.ts";

/**
 * Cap on a spool object read. The spool holds one over-threshold command and the attribute cap
 * already bounds a span well below this, so the cap exists to stop a corrupt object OOMing the
 * worker rather than to enforce a product limit.
 */
export const MAX_SPOOL_BYTES = 50 * 1024 * 1024;

/**
 * Destination-agnostic storage for the trace spool, injected so `TraceBlobStoreService`
 * carries no env coupling and the tests run without members.
 */
export interface SpoolStorage {
  /** Per-project, so a BYOC tenant's spool lands in its own bucket under its own credentials. */
  objects: TraceSpoolObjectsRepository;
  /**
   * The operator's assertion that the Azure container has the orphan-reaping
   * lifecycle rule. Injected rather than read from env here so this class keeps
   * its no-env-coupling property; the composition root owns the env read.
   */
  azureRetentionConfirmed: boolean;
}

/**
 * Thrown by an offloaded-field read when the requested row is not found or
 * the TenantId predicate returns no rows (including cross-tenant attempts).
 * ADR-022: TenantId in the WHERE clause structurally blocks cross-tenant reads.
 */
export class BlobNotFoundError extends Error {
  constructor(
    readonly eventId: string,
    readonly field: string,
    readonly tenantId: string,
  ) {
    super(`event_log row not found for eventId=${eventId} field=${field} tenantId=${tenantId}`);
    this.name = "BlobNotFoundError";
  }
}

/**
 * Thrown by an offloaded-field read when the requested `field` is not
 * present in the EventPayload. Indicates a corrupted event or a stale ref.
 */
export class BlobFieldNotFoundError extends Error {
  constructor(
    readonly key: string,
    readonly field: string,
  ) {
    super(`Field "${field}" not found in event payload at key ${key}`);
    this.name = "BlobFieldNotFoundError";
  }
}

/**
 * Raised when the project's storage destination cannot host the spool. Distinct
 * from a storage failure so the fail-open warn can say "this deployment has no
 * spool" rather than implying an outage the operator should go chase.
 */
export class SpoolDestinationUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpoolDestinationUnsupportedError";
  }
}

/**
 * Refuses a destination that cannot bound an orphaned spool object. Write path only: a rule about
 * creating new objects, not about the ones already out there.
 */
function assertDestinationCanHostSpool({
  destination,
  azureRetentionConfirmed,
}: {
  destination: TraceSpoolDestinationKind;
  azureRetentionConfirmed: boolean;
}): void {
  // The spool depends on something outside the store to stay bounded: eager delete after
  // event_log INSERT, plus a lifecycle rule reaping whatever a crash between the two leaves. A
  // filesystem has no such rule, so here an orphan is permanent.
  if (destination === "file") {
    throw new SpoolDestinationUnsupportedError(
      "The trace spool has no local-filesystem path: orphaned spool objects are reaped by a " +
        "bucket/container lifecycle rule, which a filesystem cannot express, so a crash between " +
        "the write and its delete would leave the object forever. Ingestion continues with the " +
        "full payload inline. Configure S3 or Azure Blob storage to get oversize protection.",
    );
  }

  // Same rule, applied consistently. Azure CAN express the lifecycle policy
  // the orphan bound depends on, but nothing here can confirm it exists —
  // the policy is a MANAGEMENT-plane resource this deployment's data-plane
  // key can't read. The operator asserts it at deploy time (default off);
  // enabling without provisioning retention degrades to inline payloads.
  if (destination === "azure" && !azureRetentionConfirmed) {
    throw new SpoolDestinationUnsupportedError(
      "The trace spool is disabled on Azure Blob until orphan retention is provisioned. A crash " +
        "between the spool write and its delete leaves the object behind, and only a lifecycle " +
        "rule reaps it. Create a lifecycle management policy on this container that deletes " +
        "blobs under the `trace-blobs/spool/` prefix after 3 days, then set " +
        "OBJECT_RETENTION_CONFIRMED=true (chart: `app.dataplane.objectRetentionConfirmed`; the " +
        "earlier AZURE_BLOB_SPOOL_RETENTION_CONFIRMED still works). Ingestion continues with " +
        "the full payload inline until then.",
    );
  }
}

/**
 * @see ADR-022
 * Transient spool operations on the write path and offloaded-field reads on the read path; a spool
 * object is deleted after the INSERT. Reads go through trace's payload reader, tenant first.
 */
export class TraceBlobStoreService {
  static create(options: {
    legacySpool: TraceLegacySpool;
    payloads?: TracePayloadReaderRepository;
    spoolStorage?: SpoolStorage;
    logger?: Logger;
  }): TraceBlobStoreService {
    return new TraceBlobStoreService(options);
  }

  /**
   * `legacySpool` reads back v1 spool refs only, new writes going through the object store.
   * `payloads` reads an offloaded field back out of its trace event; without it those reads
   * throw. `spoolStorage` backs spool writes, and `logger` surfaces a refused delete.
   */
  private readonly legacySpool: TraceLegacySpool;
  private readonly payloads?: TracePayloadReaderRepository;
  private readonly spoolStorage?: SpoolStorage;
  private readonly logger?: Logger;

  private constructor({
    legacySpool,
    payloads,
    spoolStorage,
    logger,
  }: {
    legacySpool: TraceLegacySpool;
    payloads?: TracePayloadReaderRepository;
    spoolStorage?: SpoolStorage;
    logger?: Logger;
  }) {
    this.legacySpool = legacySpool;
    this.payloads = payloads;
    this.spoolStorage = spoolStorage;
    this.logger = logger;
  }

  /**
   * Re-derives the spool object's address from server-trusted inputs, never a location out of
   * the command. `purpose` gates the destination guards, a write-time rule only: applying them to
   * a read would make in-flight spooled spans unreadable and manufacture the orphan they prevent.
   */
  private async locateSpool({
    projectId,
    traceId,
    spanId,
    purpose,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    purpose: "write" | "access";
  }): Promise<{ at: TraceSpoolObjectAddress; objects: TraceSpoolObjectsRepository }> {
    if (!this.spoolStorage) {
      throw new Error(
        "TraceBlobStoreService has no spool storage configured — cannot resolve the trace spool destination.",
      );
    }

    if (purpose === "write") {
      assertDestinationCanHostSpool({
        destination: await this.spoolStorage.objects.destinationKind(projectId),
        azureRetentionConfirmed: this.spoolStorage.azureRetentionConfirmed,
      });
    }

    return {
      at: { projectId, key: buildSpoolObjectPath({ projectId, traceId, spanId }) },
      objects: this.spoolStorage.objects,
    };
  }

  /**
   * Recalls offloaded fields from the trace events that recorded them (ADR-022 read path), tenant
   * first: one read per event, bounded, within a per-trace budget. Arrow property (not a prototype
   * method) so a test mock can assert on it unbound-safely.
   */
  recallFromEventLog = async ({
    tenantId,
    references,
    concurrency,
  }: {
    tenantId: string;
    references: readonly OffloadedFieldReference[];
    concurrency?: number;
  }): Promise<Map<string, OffloadRecallOutcome>> => {
    if (!this.payloads) {
      // Every field keeps its preview, each answering why, as a failed read would.
      const error = new Error(
        "No trace payload reader configured: cannot read an offloaded field (ADR-022)",
      );
      return new Map(
        references.map((reference) => [offloadedFieldKey(reference), { ok: false, error }]),
      );
    }

    return this.payloads.recall({ tenantId, references, ...(concurrency ? { concurrency } : {}) });
  };

  /**
   * Location is re-derived from projectId/traceId/spanId (queue-authenticated), never spoolRef,
   * so a tampered reference can't redirect this read. NOT fail-open, since the edge already
   * cleared span.attributes before spooling.
   */
  async getSpool({
    spoolRef,
    projectId,
    traceId,
    spanId,
  }: {
    spoolRef: string;
    projectId: string;
    traceId: string;
    spanId: string;
  }): Promise<Buffer> {
    if (isLegacySpoolRef(spoolRef)) {
      assertLegacySpoolKeyBelongsTo(spoolRef, projectId);

      return this.getLegacySpool(spoolRef, projectId);
    }

    const { at, objects } = await this.locateSpool({
      projectId,
      traceId,
      spanId,
      purpose: "access",
    });

    return TraceStreamBufferService.create().streamToBuffer(
      await objects.read(at),
      MAX_SPOOL_BYTES,
    );
  }

  /**
   * v1 read path: the reference IS the S3 key. Retained for one release so
   * commands queued across the deploy still resolve. See {@link isLegacySpoolRef}.
   */
  private async getLegacySpool(spoolRef: string, projectId: string): Promise<Buffer> {
    const body = await this.legacySpool.openRead({ projectId, key: spoolRef });

    // Read through the same bounded helper the v2 path uses. `transformToByteArray()`
    // buffers the whole object first, so it would have skipped MAX_SPOOL_BYTES
    // entirely — and a v1 reference points at an object written before this
    // deploy, which is exactly the input the cap exists to distrust.
    return TraceStreamBufferService.create().streamToBuffer(body, MAX_SPOOL_BYTES);
  }

  /**
   * Writes the transient spool object for an over-threshold command and returns the reference the
   * command carries. It lands at whichever backend the project's storage destination names and is
   * deleted after the event_log INSERT; that prefix must carry a three-day lifecycle rule.
   */
  async putSpool({
    projectId,
    traceId,
    spanId,
    body,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    body: Buffer;
  }): Promise<string> {
    const { at, objects } = await this.locateSpool({
      projectId,
      traceId,
      spanId,
      purpose: "write",
    });
    await objects.write(at, body);

    return SPOOL_REF_V2;
  }

  /**
   * Best-effort deletion of the transient spool object, called after the event_log INSERT succeeds.
   * Errors are swallowed and never thrown — the three-day lifecycle rule is the orphan safety net.
   */
  async deleteSpool({
    spoolRef,
    projectId,
    traceId,
    spanId,
  }: {
    spoolRef: string;
    projectId: string;
    traceId: string;
    spanId: string;
  }): Promise<void> {
    try {
      if (isLegacySpoolRef(spoolRef)) {
        // A refusal here is a tamper indicator, not a storage blip. The
        // best-effort swallow below is meant for the latter, so log this one
        // explicitly rather than letting it disappear into the same catch.
        try {
          assertLegacySpoolKeyBelongsTo(spoolRef, projectId);
        } catch {
          this.logger?.warn(
            { projectId, traceId, spanId },
            "Refused a cross-tenant v1 spool delete",
          );

          return;
        }

        await this.legacySpool.delete({ projectId, key: spoolRef });

        return;
      }

      const { at, objects } = await this.locateSpool({
        projectId,
        traceId,
        spanId,
        purpose: "access",
      });
      await objects.remove(at);
    } catch {
      // Best-effort — swallow all errors; lifecycle policy is the safety net.
      return;
    }
  }
}
