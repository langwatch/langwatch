/**
 * The stored-object feature's application: what its doors call.
 *
 * Four surfaces reach stored objects — the public RPC family, the `/api/files`
 * byte reader, the tRPC existence probe, and the internal dashboard adapter —
 * and each declared its own bag: `StoredObjectsPublicApp`, a pair of resolver
 * functions on the files family, `StoredObjectApplication` with a
 * deliberately-narrow probe, and a constructor argument. One object now holds
 * the union.
 *
 * The operations are the service's own and are reached through it. What this
 * object adds is that they are reached through ONE thing, and that the file
 * surface's byte read is finally NAMED: it consumes a row and a stream, which
 * `StoredObjectService.getById` does not answer with, and the mismatch had
 * been carried by an annotation that said otherwise.
 */
import type { Readable } from "node:stream";
import type {
  StoredObjectOwnerResolver,
  StoredObjectService,
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadInput,
  StoredObjectsCreateUploadOutput,
  StoredObjectsDeleteInput,
  StoredObjectsDeleteOutput,
  StoredObjectsGetInput,
  StoredObjectsGetOutput,
  StoredObjectReference,
} from "@langwatch/stored-object-contract";

/**
 * The tri-state a probe answers with, matching the `/api/files/:id` HTTP
 * route:
 *  - `available` — row exists and storage has the bytes
 *  - `missing`   — row exists but the blob is gone (compensating delete
 *                  crashed, retention sweep, and so on)
 *  - `not_found` — no row matches
 */
export type StoredObjectHead =
  | { status: "available"; mediaType: string }
  | { status: "missing"; mediaType: string }
  | { status: "not_found" };

/**
 * The row the file surface builds its response from.
 *
 * `purpose` and `owner_kind` are BOTH here because they are both gates rather
 * than description. `/api/files` picks the permission category from the
 * purpose; `/api/user-avatar` is readable by any authenticated caller on the
 * platform and is safe only because it refuses every object whose owner kind is
 * not the avatar one. The columns exist on the row and the repository already
 * selects them — projecting only `purpose` here is what left the avatar family
 * unmountable, because a broad read that cannot see the owner kind cannot
 * refuse another tenant's trace media.
 */
export interface StoredObjectFileRow {
  id: string;
  purpose: string;
  owner_kind: string;
  media_type: string;
  size_bytes: number;
}

/** What a byte read answers with when the row exists. */
export type StoredObjectFileRead =
  | { row: StoredObjectFileRow; stream: Readable }
  | { row: StoredObjectFileRow; status: "missing" };

/**
 * The stored-object reads the file surface and the probe perform.
 *
 * Separate from {@link StoredObjectService} because it is shaped differently,
 * not merely narrower: the file surface streams bytes and needs the ROW — its
 * purpose gates the read, its size and media type build the response — where
 * the portable service answers `getById` with metadata and an async iterable.
 * The process's own stored-object service satisfies both, which is why one
 * object can be passed for both keys; naming the difference is what stops the
 * two being confused for each other again.
 */
export interface StoredObjectFileReadPort {
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead>;
  getById(
    input: Readonly<{ projectId: string; id: string }>,
  ): Promise<StoredObjectFileRead | null>;
}

/** What the process composes this feature's application from. */
export interface StoredObjectAppDependencies {
  /** The portable capability: uploads, delivery capabilities, deletion. */
  storedObjects: StoredObjectService;
  /** The row-and-stream reads the file surface and the probe perform. */
  files: StoredObjectFileReadPort;
  /** Which project owns an object, when the URL does not say. */
  owners: StoredObjectOwnerResolver;
}

export class StoredObjectApp {
  static create(dependencies: StoredObjectAppDependencies): StoredObjectApp {
    return new StoredObjectApp(dependencies);
  }

  private constructor(private readonly dependencies: StoredObjectAppDependencies) {}

  /** Begins an upload and answers where to put the bytes. */
  createUpload(
    input: StoredObjectsCreateUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput> {
    return this.dependencies.storedObjects.createUpload(input);
  }

  /** Completes an upload the caller has finished writing. */
  confirmUpload(input: StoredObjectsConfirmUploadInput): Promise<StoredObjectReference> {
    return this.dependencies.storedObjects.confirmUpload(input);
  }

  /** A fresh delivery capability for one object. */
  resolveDelivery(input: StoredObjectsGetInput): Promise<StoredObjectsGetOutput> {
    return this.dependencies.storedObjects.resolveDelivery(input);
  }

  /** Removes one object. Idempotent from the caller's side. */
  delete(input: StoredObjectsDeleteInput): Promise<StoredObjectsDeleteOutput> {
    return this.dependencies.storedObjects.delete(input);
  }

  /** Whether an object's row AND its bytes exist. */
  headById(input: Readonly<{ projectId: string; id: string }>): Promise<StoredObjectHead> {
    return this.dependencies.files.headById(input);
  }

  /** One object's row and, when the bytes are there, a stream of them. */
  readById(
    input: Readonly<{ projectId: string; id: string }>,
  ): Promise<StoredObjectFileRead | null> {
    return this.dependencies.files.getById(input);
  }

  /**
   * Which project owns an object, for a URL that does not say.
   *
   * The lookup fans out across every configured instance, so a transient
   * outage on one of them raises rather than answering "no owner" — a
   * degraded instance must not read as a deleted object.
   */
  resolveOwner(input: { id: string }): Promise<{ projectId: string } | null> {
    return this.dependencies.owners.resolve(input);
  }
}
