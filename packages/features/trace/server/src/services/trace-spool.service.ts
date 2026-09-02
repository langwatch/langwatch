import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { Logger } from "@langwatch/observability";
import {
  mintStoredObjectUri,
  type StoredObjectStorageDestination,
} from "@langwatch/stored-object-contract";
import {
  TraceSpoolLegacyObjectPort,
  TraceSpoolStoragePort,
  type TraceSpoolObjectStore,
} from "../ports/trace-spool-storage.port";

/**
 * Cap on a spool object read. The spool holds one over-threshold command, and
 * `capOversizedAttributes` already bounds a span well below this — the cap
 * exists so a tampered or corrupt object cannot OOM the worker, not to enforce
 * a product limit.
 */
export const MAX_SPOOL_BYTES = 50 * 1024 * 1024;

/**
 * Prefix for all transient spool objects, kept at the TOP of the object path
 * (above the tenant segment) so a bucket/container lifecycle rule can match it
 * with a plain prefix filter. S3 lifecycle prefix filters cannot wildcard a
 * leading tenant segment, so `{projectId}/trace-blobs/spool/…` would be
 * unexpirable and orphans would accumulate forever. Do not reorder.
 */
const SPOOL_KEY_PREFIX = "trace-blobs/spool";

/**
 * Marker carried by a spooled command instead of a storage path.
 *
 * The v1 format put the raw object key in the command and the read path parsed
 * the tenant id back out of that string to pick a bucket — so whoever could
 * influence the queue message could steer a read at another tenant's object.
 * v2 carries no location at all: `getSpool`/`deleteSpool` re-derive it from the
 * command's own trusted `tenantId` + span ids, exactly as `putSpool` derived it
 * (the same discipline `TieredBlobStore`'s `BlobRef` follows).
 */
export const SPOOL_REF_V2 = "spool:v2";

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
 * Raised when a stream exceeds {@link MAX_SPOOL_BYTES}.
 *
 * The application reads the spool through a shared `streamToBuffer` utility in
 * `~/utils`. A feature package has no such utility module to reach for and the
 * cap is the whole point of the helper, so the bounded read lives beside the
 * one caller that needs it rather than becoming a new shared surface.
 */
export class SpoolStreamTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Stream exceeds ${maxBytes} bytes`);
    this.name = "StreamTooLargeError";
  }
}

async function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Buffer);
    total += buf.length;
    if (total > maxBytes) {
      stream.destroy();

      throw new SpoolStreamTooLargeError(maxBytes);
    }

    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

/**
 * Ids that are safe to use verbatim as one path segment: the normal case, since
 * OTLP ids normalise to hex. Excludes `.` and `..` explicitly — both match the
 * character class but are directory references, not names.
 */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Reduces one id to a single path component.
 *
 * Percent-encoding is NOT sufficient on its own. It survives URI construction,
 * but a filesystem driver's `parseFileUri` round-trips through
 * `decodeURIComponent`, which turns `..%2F..%2F` straight back into `../../`
 * before `mkdir`/`writeFile` see it — so an id of `../../…` escaped the object
 * root entirely. `idSchema` accepts arbitrary strings, so anyone able to ingest
 * a span could pick that path.
 *
 * Anything outside the safe class is replaced by a hash of the id rather than
 * escaped: a hash cannot contain a separator or a `..` no matter what decodes
 * it downstream, and it stays deterministic, so the read and delete paths
 * re-derive the identical location. Ordinary hex ids are untouched and remain
 * legible in a bucket listing.
 */
function safePathSegment(id: string): string {
  if (SAFE_PATH_SEGMENT.test(id) && id !== "." && id !== "..") {
    return id;
  }

  return createHash("sha256").update(id, "utf8").digest("hex");
}

/**
 * Builds the transient spool object path. The ONLY place the shape is encoded.
 */
function buildSpoolObjectPath({
  projectId,
  traceId,
  spanId,
}: {
  projectId: string;
  traceId: string;
  spanId: string;
}): string {
  return [
    SPOOL_KEY_PREFIX,
    safePathSegment(projectId),
    safePathSegment(traceId),
    safePathSegment(spanId),
  ].join("/");
}

/**
 * True when `spoolRef` has the shape of a v1 reference — a raw object key
 * minted before this deployment. Commands already queued when the new code
 * rolls out still carry these, so both formats must resolve for one release.
 *
 * Matched by prefix rather than by "not v2": treating every unrecognised string
 * as a v1 key would send it to the raw bucket+key read below, which is the very
 * dereference this change exists to remove. An unrecognised reference instead
 * falls through to the v2 path, where the location is derived and the reference
 * ignored.
 *
 * TODO(langwatch/langwatch-saas#837): drop the v1 branch one release after this
 * ships. By then no in-flight command can still carry a v1 ref — the spool's
 * own lifecycle expiry is 3 days, so nothing can resolve one after that.
 */
function isLegacySpoolRef(spoolRef: string): boolean {
  return spoolRef.startsWith(`${SPOOL_KEY_PREFIX}/`);
}

/**
 * Extracts the projectId segment from a v1 spool key.
 *
 * The caller must check it against the command's authenticated tenant before
 * dereferencing — see {@link assertLegacySpoolKeyBelongsTo}.
 */
function projectIdFromLegacySpoolKey(spoolRef: string): string {
  return spoolRef.split("/")[SPOOL_KEY_PREFIX.split("/").length] ?? "";
}

/**
 * Refuses a v1 key whose tenant segment is not the tenant the command was
 * authenticated as.
 *
 * The v1 format is the one place a location still travels inside the command,
 * so it is the one place a tampered reference could still steer a read. Pinning
 * it to the command's own tenant keeps the compatibility window from reopening
 * the hole the v2 format closes.
 */
function assertLegacySpoolKeyBelongsTo(spoolRef: string, projectId: string): void {
  const keyProjectId = projectIdFromLegacySpoolKey(spoolRef);
  if (keyProjectId !== projectId) {
    throw new Error(
      `Refusing to read spool object: reference names tenant "${keyProjectId}" but the command is authenticated as "${projectId}".`,
    );
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
  storage: TraceSpoolStoragePort;
  /** Absent on a deployment that never wrote a v1 reference; see the port. */
  legacyObjects?: TraceSpoolLegacyObjectPort;
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
 * Transient spool operations for the ADR-022 write path.
 *
 * A per-span transient object carries over-threshold command payloads from the
 * edge to the command worker. It is eagerly deleted after the event_log INSERT
 * succeeds; a 3-day lifecycle policy is the safety net for orphans (3 days
 * covers weekend incidents that need catch-up time).
 *
 * Spool writes go through the shared stored-objects layer, so the spool lands
 * wherever the project's storage destination points — S3, Azure Blob, or the
 * local filesystem. It used to speak the AWS SDK directly, which made it the
 * one byte-writing surface that silently ignored a deployment's Azure
 * configuration (langwatch/langwatch-saas#800).
 */
export class TraceSpoolService {
  static create(options: TraceSpoolServiceOptions): TraceSpoolService {
    return new TraceSpoolService(options);
  }

  private constructor(private readonly options: TraceSpoolServiceOptions) {}

  /**
   * Fetches the full span body from the transient spool object.
   * Called by the command worker when a command carries a `spoolRef`.
   *
   * The object's location is re-derived from `projectId` / `traceId` / `spanId`
   * — all read from the command itself, which the queue authenticated — rather
   * than from `spoolRef`. A tampered reference therefore cannot redirect this
   * read at another tenant's bytes; the worst it can do is name a v1 format and
   * miss.
   *
   * NOT fail-open, deliberately: the edge cleared `span.attributes` before
   * spooling, so returning nothing here would write an empty span to
   * `event_log` — permanent, silent loss in the sole source of truth. Throwing
   * lets the command retry.
   */
  async getSpool(identity: TraceSpoolIdentity): Promise<Buffer> {
    if (isLegacySpoolRef(identity.spoolRef)) {
      assertLegacySpoolKeyBelongsTo(identity.spoolRef, identity.projectId);

      return this.getLegacySpool(identity.spoolRef, identity.projectId);
    }

    const { uri, objectStore } = await this.mintSpoolUri({ ...identity, purpose: "access" });

    return streamToBuffer(await objectStore.get(uri), MAX_SPOOL_BYTES);
  }

  /**
   * Writes the transient spool object for an over-threshold command payload and
   * returns the reference the command will carry.
   *
   * The object lands at whichever backend the project's storage destination
   * names. Object path: `trace-blobs/spool/{projectId}/{traceId}/{spanId}` —
   * transient, eagerly deleted after the event_log INSERT succeeds. The
   * bucket/container MUST have a 3-day lifecycle rule on the
   * `trace-blobs/spool/` prefix as the safety net for orphans.
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
   * Re-derives the spool object's URI from server-trusted inputs. Never reads a
   * location out of the command.
   *
   * `purpose` decides whether the destination guards apply. They exist to stop
   * a NEW object landing where nothing will reap it, so they are a write-time
   * rule only. Applying them to a read or a delete would punish the objects
   * already on disk: an operator who turns the retention assertion back off —
   * the documented remediation, and what a chart rollback does — would make
   * every in-flight spooled span permanently unreadable (`getSpool` does not
   * fail open, and the edge already cleared the attributes), and would stop the
   * eager delete that is the spool's FIRST line of cleanup, manufacturing
   * exactly the orphan the guard is there to prevent.
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

    return streamToBuffer(body, MAX_SPOOL_BYTES);
  }

  private legacyObjects(): TraceSpoolLegacyObjectPort {
    const legacy = this.options.legacyObjects;
    if (!legacy) {
      throw new Error(
        "This spool composition has no v1 object transport, so a v1 spool reference cannot be resolved.",
      );
    }

    return legacy;
  }
}
