import { HandledError, type HandledErrorFault } from "@langwatch/handled-error";
import { z } from "zod";
import type {
  StoredObjectId,
  StoredObjectOperationId,
  StoredObjectProjectId,
} from "./ids";

export const STORED_OBJECT_PROBLEM_CODES = [
  "direct_upload_unavailable",
  "upload_too_large",
  "upload_token_invalid",
  "upload_expired",
  "upload_incomplete",
  "upload_checksum_mismatch",
  "upload_failed",
  "stored_object_integrity_conflict",
  "stored_object_deleted",
  "stored_object_not_found",
  "stored_object_missing",
  "stored_object_unavailable",
  "storage_unavailable",
  "idempotency_conflict",
] as const;

export const storedObjectProblemCodeSchema = z.enum(STORED_OBJECT_PROBLEM_CODES);
export type StoredObjectProblemCode = z.infer<typeof storedObjectProblemCodeSchema>;

/** Client-safe problem envelope consumed by REST, RPC, tRPC, and byte delivery. */
export const storedObjectProblemSchema = z
  .object({
    code: storedObjectProblemCodeSchema,
    type: storedObjectProblemCodeSchema.optional(),
    kind: storedObjectProblemCodeSchema.optional(),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
    reasons: z.array(z.unknown()).optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    traceUrl: z.string().url().optional(),
    httpStatus: z.number().int().min(400).max(599).optional(),
    fault: z.enum(["customer", "platform", "provider"]).optional(),
    tips: z.array(z.string()).optional(),
    docsUrl: z.string().url().optional(),
  })
  .strict();
export type StoredObjectProblem = z.infer<typeof storedObjectProblemSchema>;

export const STORED_OBJECT_PROBLEM_HTTP_STATUS = {
  direct_upload_unavailable: 503,
  upload_too_large: 413,
  upload_token_invalid: 400,
  upload_expired: 410,
  upload_incomplete: 409,
  upload_checksum_mismatch: 422,
  upload_failed: 502,
  stored_object_integrity_conflict: 409,
  stored_object_deleted: 410,
  stored_object_not_found: 404,
  stored_object_missing: 404,
  stored_object_unavailable: 409,
  storage_unavailable: 502,
  idempotency_conflict: 409,
} as const satisfies Record<StoredObjectProblemCode, number>;

abstract class StoredObjectHandledError extends HandledError {
  protected constructor(
    code: StoredObjectProblemCode,
    message: string,
    options: {
      meta?: Record<string, unknown>;
      fault?: HandledErrorFault;
      tips?: readonly string[];
    } = {},
  ) {
    super(code, message, {
      ...options,
      httpStatus: STORED_OBJECT_PROBLEM_HTTP_STATUS[code],
    });
  }
}

export class DirectUploadUnavailableError extends StoredObjectHandledError {
  readonly name = "DirectUploadUnavailableError";

  constructor() {
    super(
      "direct_upload_unavailable",
      "Direct upload is unavailable for the selected storage destination.",
      { fault: "platform" },
    );
  }
}

export class UploadTooLargeError extends StoredObjectHandledError {
  readonly name = "UploadTooLargeError";

  constructor(
    readonly byteLength: number,
    readonly maximumUploadBytes: number,
  ) {
    super("upload_too_large", "The declared upload is too large.", {
      meta: { byteLength, maximumUploadBytes },
      tips: ["Reduce the file size and create a new upload."],
    });
  }
}

export class UploadTokenInvalidError extends StoredObjectHandledError {
  readonly name = "UploadTokenInvalidError";

  constructor() {
    super("upload_token_invalid", "The upload token is invalid.");
  }
}

export class UploadExpiredError extends StoredObjectHandledError {
  readonly name = "UploadExpiredError";

  constructor(readonly operationId?: StoredObjectOperationId) {
    super("upload_expired", "The upload has expired.", {
      meta: operationId ? { operationId } : undefined,
      tips: ["Create a new upload before sending the bytes again."],
    });
  }
}

export class UploadIncompleteError extends StoredObjectHandledError {
  readonly name = "UploadIncompleteError";

  constructor(readonly operationId?: StoredObjectOperationId) {
    super("upload_incomplete", "The uploaded bytes are not complete.", {
      meta: operationId ? { operationId } : undefined,
      tips: ["Finish the signed upload before confirming it."],
    });
  }
}

export class UploadChecksumMismatchError extends StoredObjectHandledError {
  readonly name = "UploadChecksumMismatchError";

  constructor(readonly operationId?: StoredObjectOperationId) {
    super(
      "upload_checksum_mismatch",
      "The uploaded bytes do not match their declared checksum.",
      {
        meta: operationId ? { operationId } : undefined,
        tips: ["Create a new upload using the SHA-256 of the exact bytes."],
      },
    );
  }
}

export class UploadFailedError extends StoredObjectHandledError {
  readonly name = "UploadFailedError";

  constructor(readonly operationId?: StoredObjectOperationId) {
    super("upload_failed", "The upload could not be completed.", {
      meta: operationId ? { operationId } : undefined,
      fault: "provider",
      tips: ["Retry confirmation; the operation keeps its durable result."],
    });
  }
}

export class StoredObjectIntegrityConflictError extends StoredObjectHandledError {
  readonly name = "StoredObjectIntegrityConflictError";

  constructor(
    readonly projectId: StoredObjectProjectId,
    readonly objectId: StoredObjectId,
    readonly expectedByteLength: number,
    readonly actualByteLength: number,
  ) {
    super(
      "stored_object_integrity_conflict",
      "Existing content has conflicting verified byte facts.",
      {
        meta: {
          projectId,
          objectId,
          expectedByteLength,
          actualByteLength,
        },
      },
    );
  }
}

export class StoredObjectDeletedError extends StoredObjectHandledError {
  readonly name = "StoredObjectDeletedError";

  constructor(
    readonly projectId: StoredObjectProjectId,
    readonly objectId: StoredObjectId,
  ) {
    super("stored_object_deleted", "The stored object was deleted.", {
      meta: { projectId, objectId },
    });
  }
}

export class StoredObjectNotFoundError extends StoredObjectHandledError {
  readonly name = "StoredObjectNotFoundError";

  constructor() {
    // Deliberately carries no project/object metadata: this error is also the
    // non-disclosing response for cross-project and audience denials.
    super("stored_object_not_found", "The stored object was not found.");
  }
}

export class StoredObjectBytesMissingError extends StoredObjectHandledError {
  readonly name = "StoredObjectBytesMissingError";

  constructor(
    readonly projectId: StoredObjectProjectId,
    readonly objectId: StoredObjectId,
  ) {
    super("stored_object_missing", "The stored object's bytes are missing.", {
      meta: { projectId, objectId },
      fault: "platform",
    });
  }
}

export class StoredObjectUnavailableError extends StoredObjectHandledError {
  readonly name = "StoredObjectUnavailableError";

  constructor(
    readonly projectId: StoredObjectProjectId,
    readonly objectId: StoredObjectId,
  ) {
    super("stored_object_unavailable", "The stored object is not currently available.", {
      meta: { projectId, objectId },
    });
  }
}

export class StorageUnavailableError extends StoredObjectHandledError {
  readonly name = "StorageUnavailableError";

  constructor() {
    // Provider locators and driver details must remain in server-side causes.
    super("storage_unavailable", "Object storage is temporarily unavailable.", {
      fault: "provider",
      tips: ["Retry the request later."],
    });
  }
}

export class IdempotencyConflictError extends StoredObjectHandledError {
  readonly name = "IdempotencyConflictError";

  constructor() {
    super(
      "idempotency_conflict",
      "The idempotency key was already used for different input.",
      { tips: ["Use a new idempotency key for the new command."] },
    );
  }
}
