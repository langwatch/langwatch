import {
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  UnauthorizedError,
} from "@langwatch/api/rest";
import { ProjectPermissionDeniedError } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import {
  FILE_VIEW_PERMISSIONS,
  isReadbackSafe,
  StorageUnavailableError,
  StoredObjectBytesMissingError,
  StoredObjectFilesRateLimitedError,
  storedObjectIdSchema,
  StoredObjectOwnerLookupUnavailableError,
  storedObjectProjectIdSchema,
  type StoredObjectFileViewPermission,
} from "@langwatch/stored-object-contract";
import { nowInstant } from "@langwatch/time";

import type {
  StoredObjectFileBytes,
  StoredObjectFileCaller,
  StoredObjectFileReadInput,
  StoredObjectFileStreamRead,
} from "#app/stored-object.members";
import { isPermissionDenial } from "#rules/stored-object-file-access.rules";
import { requiredPermissionForPurpose } from "#rules/stored-object-purpose-permission.rules";

/** Per-caller rate limit on the read routes. */
const FILES_RATE_LIMIT_WINDOW_SECONDS = 60;
const FILES_RATE_LIMIT_MAX = 120;

/** What one count of a caller's reads answers. */
export type StoredObjectFileAllowance = Readonly<{ allowed: boolean; resetAt: number }>;

/** The counter, the person's permission and the two reads the byte door asks. */
export interface StoredObjectFileGate {
  countRead(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<StoredObjectFileAllowance>;
  assertProjectPermission(input: {
    userId: string;
    projectId: string;
    permission: StoredObjectFileViewPermission;
  }): Promise<void>;
  /** Whether the project holds a Postgres row for the object, in any status. */
  isRecorded(input: { projectId: string; id: string }): Promise<boolean>;
  /** Which project owns an object, for a URL that does not say. Throws when none does. */
  resolveOwner(input: { id: string }): Promise<{ projectId: string }>;
  /** One object's row and, when the bytes are there, a stream of them. Throws when absent. */
  readById(input: { projectId: string; id: string }): Promise<StoredObjectFileStreamRead>;
}

type Found = Extract<StoredObjectFileStreamRead, { stream: unknown }>;

/**
 * Count the caller, resolve the owner, admit the caller to that project, read
 * the row, then hold the caller to the permission the object's purpose maps
 * to. The order is the byte door's whole security argument.
 */
export class StoredObjectFileReadService {
  static create(gate: StoredObjectFileGate): StoredObjectFileReadService {
    return new StoredObjectFileReadService(gate);
  }

  private constructor(private readonly gate: StoredObjectFileGate) {}

  /** The safe media type, the stored length, the sanitised filename and the hardening headers. */
  static bytesOf(input: {
    found: Found;
    requestedFilename?: string | undefined;
  }): StoredObjectFileBytes {
    const { row, stream } = input.found;
    const filename =
      (input.requestedFilename ? sanitizeFilenameSegment(input.requestedFilename) : "") ||
      sanitizeFilenameSegment(row.id);

    return {
      stream,
      mediaType: safeMediaType({ mediaType: row.media_type, readbackSafe: isReadbackSafe }),
      byteLength: row.size_bytes,
      headers: {
        "Content-Disposition": `inline; filename="${filename}"`,
        ...STORED_OBJECT_RESPONSE_BASE_HEADERS,
      },
    };
  }

  async read(input: StoredObjectFileReadInput): Promise<StoredObjectFileBytes> {
    const { caller } = input;
    await this.countCaller(caller);

    // Pinned once: the gate and the read MUST use the same owner.
    const ownerProjectId = await this.ownerOf(input);
    await this.authorizeFileRead({ caller, ownerProjectId });

    const found = await this.readOf({ ownerProjectId, id: input.id });
    await this.authorizeFilePurpose({ caller, ownerProjectId, purpose: found.row.purpose });

    return StoredObjectFileReadService.bytesOf({
      found,
      requestedFilename: input.requestedFilename,
    });
  }

  private async countCaller(caller: StoredObjectFileCaller): Promise<void> {
    // Keyed on the caller, so id probes are throttled before the cross-tenant lookup. The
    // door sets one of the two; refuse rather than fall back to a shared bucket.
    const callerKey = caller.apiKeyProjectId ?? caller.userId;
    if (!callerKey) throw new Error("rate-limit key unresolved");

    const allowance = await this.gate.countRead({
      key: `files-route:caller:${callerKey}`,
      windowSeconds: FILES_RATE_LIMIT_WINDOW_SECONDS,
      max: FILES_RATE_LIMIT_MAX,
    });
    if (!allowance.allowed) {
      const waitMs = Math.max(0, allowance.resetAt - nowInstant().epochMilliseconds);
      throw new StoredObjectFilesRateLimitedError(waitMs);
    }
  }

  /**
   * The scoped URL names its owner. The id-only URL asks the key's own project's rows first
   * (uploads live only in Postgres), then the legacy cross-tenant index.
   */
  private async ownerOf(input: StoredObjectFileReadInput): Promise<string> {
    if (input.claimedProjectId) return input.claimedProjectId;

    const own = input.caller.apiKeyProjectId;
    if (own && (await this.gate.isRecorded({ projectId: own, id: input.id }))) return own;

    try {
      return (await this.gate.resolveOwner({ id: input.id })).projectId;
    } catch (err) {
      // A degraded instance must not read as a deleted object.
      if (err instanceof StoredObjectOwnerLookupUnavailableError) {
        throw new StorageUnavailableError();
      }
      throw err;
    }
  }

  /** A storage failure other than a miss is an outage, not a deletion. */
  private async readOf(input: { ownerProjectId: string; id: string }): Promise<Found> {
    let result: StoredObjectFileStreamRead;
    try {
      result = await this.gate.readById({ projectId: input.ownerProjectId, id: input.id });
    } catch (err) {
      if (HandledError.isHandled(err) && err.code === "stored_object_not_found") throw err;
      throw new StorageUnavailableError();
    }
    if ("stream" in result) return result;

    throw new StoredObjectBytesMissingError(
      storedObjectProjectIdSchema.parse(input.ownerProjectId),
      storedObjectIdSchema.parse(input.id),
    );
  }

  /**
   * Whether the caller may read objects owned by `ownerProjectId` at all. The
   * purpose is not known yet, so ANY file-view permission admits; a key is
   * pinned to the project it resolved to, and reads every file there.
   */
  private async authorizeFileRead(input: {
    caller: StoredObjectFileCaller;
    ownerProjectId: string;
  }): Promise<void> {
    const { caller, ownerProjectId } = input;
    if (caller.apiKeyProjectId) {
      if (caller.apiKeyProjectId !== ownerProjectId) throw fileViewDenied();

      return;
    }

    const userId = caller.userId;
    if (!userId) throw new UnauthorizedError("unauthenticated");

    for (const permission of FILE_VIEW_PERMISSIONS) {
      if (await this.holds({ userId, projectId: ownerProjectId, permission })) return;
    }

    throw fileViewDenied();
  }

  /** The permission the object's purpose maps to, asked once the row is known. */
  private async authorizeFilePurpose(input: {
    caller: StoredObjectFileCaller;
    ownerProjectId: string;
    purpose: string;
  }): Promise<void> {
    const permission = requiredPermissionForPurpose(input.purpose);

    // A key was pinned to the owner already, and reads every purpose there.
    if (input.caller.apiKeyProjectId) return;

    const userId = input.caller.userId;
    if (!userId) return;

    if (!(await this.holds({ userId, projectId: input.ownerProjectId, permission }))) {
      throw new ProjectPermissionDeniedError(permission);
    }
  }

  /** A documented denial answers false; any other failure bubbles as a 5xx. */
  private async holds(input: {
    userId: string;
    projectId: string;
    permission: StoredObjectFileViewPermission;
  }): Promise<boolean> {
    try {
      await this.gate.assertProjectPermission(input);
      return true;
    } catch (err) {
      if (!isPermissionDenial(err)) throw err;
      return false;
    }
  }
}

function fileViewDenied(): ProjectPermissionDeniedError {
  return new ProjectPermissionDeniedError(FILE_VIEW_PERMISSIONS.join(" | "));
}
