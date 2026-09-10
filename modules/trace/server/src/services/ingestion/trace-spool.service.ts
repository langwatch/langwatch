import type { Logger } from "@langwatch/observability";
import {
  mintStoredObjectUri,
  type StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import {
  TraceSpoolLegacyObject,
  TraceSpoolStorage,
  type TraceSpoolObjectStore,
} from "../../app/trace.members.ts";
import {
  assertLegacySpoolKeyBelongsTo,
  buildSpoolObjectPath,
  isLegacySpoolRef,
  SPOOL_REF_V2,
} from "../../rules/trace-spool-location.rules.ts";
import { TraceStreamBufferService } from "./trace-stream-buffer.service.ts";

/**
 * Cap on a spool object read. The spool holds one over-threshold command, and
 * `capOversizedAttributes` already bounds a span well below this — the cap
 * exists so a tampered or corrupt object cannot OOM the worker, not to enforce
 * a product limit.
 */
export const MAX_SPOOL_BYTES = 50 * 1024 * 1024;

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
 * Refuses a destination that cannot bound an orphaned spool object.
 *
 * WRITE PATH ONLY. This is a rule about creating new objects, not about the
 * ones already out there — see the `purpose` note on `mintSpoolUri`.
 */
function assertDestinationCanHostSpool({
  destination,
  azureRetentionConfirmed,
}: {
  destination: StoredObjectStorageDestination;
  azureRetentionConfirmed: boolean;
}): void {
  // The spool is the one stored-objects consumer that depends on something
  // OUTSIDE the object store to stay bounded: it deletes eagerly after the
  // event_log INSERT, and leans on a lifecycle rule to reap whatever a crash
  // between those two steps leaves behind. A filesystem has no such rule, so
  // on this destination an orphan is permanent and the volume is what fills.
  if (destination.kind === "file") {
    throw new SpoolDestinationUnsupportedError(
      "The trace spool has no local-filesystem path: orphaned spool objects are reaped by a " +
        "bucket/container lifecycle rule, which a filesystem cannot express, so a crash between " +
        "the write and its delete would leave the object forever. Ingestion continues with the " +
        "full payload inline. Configure S3 or Azure Blob storage to get oversize protection.",
    );
  }

  // Same rule, applied consistently. Azure CAN express the lifecycle policy
  // the orphan bound depends on — but nothing here can confirm it exists. The
  // policy is a MANAGEMENT-plane resource; this deployment holds a data-plane
  // key only. The operator asserts it at deploy time, in the same config that
  // turns the spool on, and the default is off.
  if (destination.kind === "azure" && !azureRetentionConfirmed) {
    throw new SpoolDestinationUnsupportedError(
      "The trace spool is disabled on Azure Blob until orphan retention is provisioned. A crash " +
        "between the spool write and its delete leaves the object behind, and only a lifecycle " +
        "rule reaps it. Create a lifecycle management policy on this container that deletes " +
        "blobs under the `trace-blobs/spool/` prefix after 3 days, then set " +
        "AZURE_BLOB_SPOOL_RETENTION_CONFIRMED=true (chart: " +
        "`app.dataplane.providers.azureBlob.spoolRetentionConfirmed`). Ingestion continues with " +
        "the full payload inline until then.",
    );
  }
}

export type TraceSpoolServiceOptions = {
  storage: TraceSpoolStorage;
  /** Absent on a deployment that never wrote a v1 reference; see the port. */
  legacyObjects?: TraceSpoolLegacyObject;
  /**
   * Used only to surface a refused cross-tenant delete, which `deleteSpool`'s
   * best-effort swallow would otherwise hide.
   */
  logger?: Logger;
};

/** One span's transient over-threshold payload, keyed by the command's own ids. */
export type TraceSpoolIdentity = {
  spoolRef: string;
  projectId: string;
  traceId: string;
  spanId: string;
};

/**
 * Transient spool operations for the ADR-022 write path. A per-span transient object carries
 * over-threshold command payloads from the edge to the command worker, eagerly deleted after
 * the event_log INSERT succeeds; a 3-day lifecycle policy is the safety net for orphans. Spool
 * writes go through the shared stored-objects layer, so the spool lands wherever the project's
 * storage destination points.
 */
export class TraceSpoolService {
  static create(options: TraceSpoolServiceOptions): TraceSpoolService {
    return new TraceSpoolService(options);
  }

  private constructor(private readonly options: TraceSpoolServiceOptions) {}

  /**
   * The object's location is re-derived from `projectId`/`traceId`/`spanId` — read from the
   * queue-authenticated command, never from `spoolRef` — so a tampered reference cannot redirect
   * this read at another tenant's bytes. NOT fail-open: the edge already cleared
   * `span.attributes`, so returning nothing would write a permanently empty span to `event_log`.
   */
  async getSpool(identity: TraceSpoolIdentity): Promise<Buffer> {
    if (isLegacySpoolRef(identity.spoolRef)) {
      assertLegacySpoolKeyBelongsTo(identity.spoolRef, identity.projectId);

      return this.getLegacySpool(identity.spoolRef, identity.projectId);
    }

    const { uri, objectStore } = await this.mintSpoolUri({ ...identity, purpose: "access" });

    return TraceStreamBufferService.streamToBuffer(await objectStore.get(uri), MAX_SPOOL_BYTES);
  }

  /**
   * Object path: `trace-blobs/spool/{projectId}/{traceId}/{spanId}` — transient, eagerly deleted
   * after the event_log INSERT succeeds. The bucket/container must have a 3-day lifecycle rule
   * on that prefix as the safety net for orphans.
   */
  async putSpool(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    body: Buffer;
  }): Promise<string> {
    const { uri, objectStore } = await this.mintSpoolUri({ ...input, purpose: "write" });
    await objectStore.put(uri, input.body, "application/octet-stream");

    return SPOOL_REF_V2;
  }

  /**
   * Best-effort deletion of the transient spool object.
   * Called after the event_log INSERT succeeds. Errors are swallowed — the
   * 3-day lifecycle rule is the safety net for orphans.
   */
  async deleteSpool(identity: TraceSpoolIdentity): Promise<void> {
    try {
      if (isLegacySpoolRef(identity.spoolRef)) {
        // A refusal here is a tamper indicator, not a storage blip. The
        // best-effort swallow below is meant for the latter, so log this one
        // explicitly rather than letting it disappear into the same catch.
        try {
          assertLegacySpoolKeyBelongsTo(identity.spoolRef, identity.projectId);
        } catch {
          this.options.logger?.warn(
            {
              projectId: identity.projectId,
              traceId: identity.traceId,
              spanId: identity.spanId,
            },
            "Refused a cross-tenant v1 spool delete",
          );

          return;
        }

        await this.legacyObjects().delete({
          projectId: identity.projectId,
          key: identity.spoolRef,
        });

        return;
      }

      const { uri, objectStore } = await this.mintSpoolUri({ ...identity, purpose: "access" });
      await objectStore.delete(uri);
    } catch {
      // Best-effort — swallow all errors; lifecycle policy is the safety net.
    }
  }

  /**
   * Re-derives the spool object's URI from server-trusted inputs, never from the command.
   * `purpose` gates the destination guards to write time only: applying them to a read or
   * delete would make in-flight spooled spans permanently unreadable and block the eager
   * delete that is the spool's first line of cleanup.
   */
  private async mintSpoolUri(input: {
    projectId: string;
    traceId: string;
    spanId: string;
    purpose: "write" | "access";
  }): Promise<{ uri: string; objectStore: TraceSpoolObjectStore }> {
    const storage = this.options.storage;
    const destination = await storage.resolveDestination(input.projectId);

    if (input.purpose === "write") {
      assertDestinationCanHostSpool({
        destination,
        azureRetentionConfirmed: storage.azureRetentionConfirmed,
      });
    }

    return {
      uri: mintStoredObjectUri({
        destination,
        objectPath: buildSpoolObjectPath(input),
      }),
      objectStore: storage.objectStoreFor(input.projectId),
    };
  }

  /**
   * v1 read path: the reference IS the object key. Retained for one release so
   * commands queued across the deploy still resolve. See {@link isLegacySpoolRef}.
   *
   * Read through the same bounded helper the v2 path uses. A v1 reference points
   * at an object written before this deploy, which is exactly the input the cap
   * exists to distrust.
   */
  private async getLegacySpool(spoolRef: string, projectId: string): Promise<Buffer> {
    const body = await this.legacyObjects().read({ projectId, key: spoolRef });

    return TraceStreamBufferService.streamToBuffer(body, MAX_SPOOL_BYTES);
  }

  private legacyObjects(): TraceSpoolLegacyObject {
    const legacy = this.options.legacyObjects;
    if (!legacy) {
      throw new Error(
        "This spool composition has no v1 object transport, so a v1 spool reference cannot be resolved.",
      );
    }

    return legacy;
  }
}
