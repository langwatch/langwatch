import type { Readable } from "node:stream";
import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";

/**
 * The slice of the stored-objects registry the spool needs. Declared here
 * rather than imported so this module depends on a shape, not on the registry
 * class — the registry satisfies it structurally.
 */
export interface TraceSpoolObjectStore {
  put(uri: string, bytes: Buffer, mediaType: string): Promise<void>;
  get(uri: string): Promise<Readable>;
  delete(uri: string): Promise<void>;
}

/**
 * Destination-agnostic storage for the trace spool, injected so the spool
 * service carries no env coupling and the tests run without infrastructure.
 *
 * This is the application's `SpoolStorage` interface as an abstract class. The
 * rename is the only difference: `port-modules` requires a runtime boundary in
 * a strict feature package to be a nominal abstract class, and the composition
 * roots that satisfy it are structural either way.
 */
export abstract class TraceSpoolStoragePort {
  /** Per-project so BYOC tenants resolve their own bucket and credentials. */
  abstract objectStoreFor(projectId: string): TraceSpoolObjectStore;
  abstract resolveDestination(projectId: string): Promise<StoredObjectStorageDestination>;
  /**
   * The operator's assertion that the Azure container has the orphan-reaping
   * lifecycle rule. Injected rather than read from env here so this class keeps
   * its no-env-coupling property; the composition root owns the env read.
   */
  abstract readonly azureRetentionConfirmed: boolean;
}

/**
 * The v1 spool read, where the reference IS the object key rather than a
 * derived location.
 *
 * The application reaches this path with a raw `S3Client` built from a
 * per-organization resolver. A feature package cannot name a vendor SDK, and
 * this branch is a one-release compatibility window that the v2 format exists
 * to close (langwatch/langwatch-saas#837), so it is an injected port instead:
 * a composition that has no legacy transport omits it, and the legacy branch
 * then refuses by name rather than silently resolving somewhere else.
 */
export abstract class TraceSpoolLegacyObjectPort {
  abstract read(input: { projectId: string; key: string }): Promise<Readable>;
  abstract delete(input: { projectId: string; key: string }): Promise<void>;
}
