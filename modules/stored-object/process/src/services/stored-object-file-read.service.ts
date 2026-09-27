import {
  safeMediaType,
  sanitizeFilenameSegment,
  STORED_OBJECT_RESPONSE_BASE_HEADERS,
  UnauthorizedError,
  type RequestActor,
} from "@langwatch/api/rest";
import { ProjectPermissionDeniedError, type AuthzPermission } from "@langwatch/authz-contract";
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
  StoredObjectFileReadInput,
  StoredObjectFileStreamRead,
} from "#app/stored-object.members";
import { isPermissionDenial } from "#rules/stored-object-file-access.rules";
import { requiredPermissionForPurpose } from "#rules/stored-object-purpose-permission.rules";

/** Per-caller rate limit on the read routes. */
const FILES_RATE_LIMIT_WINDOW_SECONDS = 60;
const FILES_RATE_LIMIT_MAX = 120;

/**
 * Who the deployment's verifier let in. The key's own ceiling travels with it,
 * so both gates ask the credential this request actually carried.
 */
export type StoredObjectFileCaller = Readonly<{
  apiKeyProjectId?: string | undefined;
  userId?: string | undefined;
  apiKeyCeiling?: ((permission: AuthzPermission) => Promise<void>) | undefined;
}>;

/** What one count of a caller's reads answers. */
export type StoredObjectFileAllowance = Readonly<{ allowed: boolean; resetAt: number }>;

/** The verifier, the counter, the person's permission and the two reads the byte door asks. */
export interface StoredObjectFileGate {
  identify(input: { actor: RequestActor | null }): Promise<StoredObjectFileCaller>;
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

  async read(input: StoredObjectFileReadInput): Promise<StoredObjectFileBytes> {
    const caller = await this.gate.identify({ actor: input.actor });
    await this.countCaller(caller);

    // Pinned once: the gate and the read MUST use the same owner.
    const ownerProjectId = await this.ownerOf(input);
    await this.authorizeFileRead({ caller, ownerProjectId });

    const found = await this.readOf({ ownerProjectId, id: input.id });
    await this.authorizeFilePurpose({ caller, ownerProjectId, purpose: found.row.purpose });

    return bytesOf({ found, requestedFilename: input.requestedFilename });
  }

  private async countCaller(caller: StoredObjectFileCaller): Promise<void> {
    // Keyed on the caller, so id probes are throttled before the cross-tenant lookup. The
    // verifier sets one of the two; refuse rather than fall back to a shared bucket.
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

  /** The scoped URL names its owner; the id-only URL falls back to the cross-tenant lookup. */
  private async ownerOf(input: StoredObjectFileReadInput): Promise<string> {
    if (input.claimedProjectId) return input.claimedProjectId;

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
   * pinned to the project it resolved to AND capped by its own ceiling.
   */
  private async authorizeFileRead(input: {
    caller: StoredObjectFileCaller;
    ownerProjectId: string;
  }): Promise<void> {
    const { caller, ownerProjectId } = input;
    if (caller.apiKeyProjectId) {
      if (caller.apiKeyProjectId !== ownerProjectId) throw fileViewDenied();

      return enforceAnyOf(ceilingOf(caller), FILE_VIEW_PERMISSIONS);
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

    // The key's own refusal, with its own code.
    if (input.caller.apiKeyProjectId) return ceilingOf(input.caller)(permission);

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

/** The verifier sets a ceiling on every key it resolves; refuse rather than read without one. */
function ceilingOf(caller: StoredObjectFileCaller): (permission: AuthzPermission) => Promise<void> {
  const ceiling = caller.apiKeyCeiling;
  if (!ceiling) throw new Error("api key ceiling unresolved");

  return ceiling;
}

/** The key's ceiling, satisfied by ANY of the permissions a file read can need. */
async function enforceAnyOf(
  ceiling: (permission: AuthzPermission) => Promise<void>,
  permissions: readonly AuthzPermission[],
): Promise<void> {
  let refusal: unknown;
  for (const permission of permissions) {
    try {
      await ceiling(permission);
      return;
    } catch (err) {
      if (!HandledError.isHandled(err)) throw err;
      refusal = err;
    }
  }
  throw refusal;
}

/** The safe media type, the stored length, the sanitised filename and the hardening headers. */
function bytesOf(input: {
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
