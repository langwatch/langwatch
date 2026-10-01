/**
 * The local backend's upload URL and every backend's read URL: claims sealed by
 * the process's `encryption` member (AES-256-GCM, whose seal is its own signature). ADR-158 §4.
 */
import { UnauthorizedError } from "@langwatch/api/rest";
import type { Encryption } from "@langwatch/process-stores/members";
import {
  DirectUploadUnavailableError,
  UploadExpiredError,
  UploadTokenInvalidError,
} from "@langwatch/stored-object-contract";
import { type Instant, Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

const sealedUploadSchema = z
  .object({
    projectId: z.string().min(1),
    objectId: z.string().min(1),
    byteLength: z.number().int().nonnegative().safe(),
    mediaType: z.string().min(1),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type SealedUpload = z.infer<typeof sealedUploadSchema>;

// `kind` keeps a read seal from opening as an upload, and an upload seal from opening as a read.
const sealedReadSchema = z
  .object({
    kind: z.literal("read"),
    projectId: z.string().min(1),
    objectId: z.string().min(1),
    filename: z.string().optional(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type SealedRead = z.infer<typeof sealedReadSchema>;

export class StoredObjectUploadSignerService {
  static create(input: {
    encryption: Encryption;
    publicBaseUrl: string | undefined;
  }): StoredObjectUploadSignerService {
    return new StoredObjectUploadSignerService(input.encryption, input.publicBaseUrl);
  }

  private constructor(
    private readonly encryption: Encryption,
    private readonly publicBaseUrl: string | undefined,
  ) {}

  /** The URL a client PUTs a local upload to; refuses where the deployment names no origin. */
  urlFor(input: {
    projectId: string;
    objectId: string;
    byteLength: number;
    mediaType: string;
    expiresAt: Instant;
  }): string {
    if (this.publicBaseUrl === undefined) throw new DirectUploadUnavailableError();

    const seal = this.encryption.encrypt(
      JSON.stringify({ ...input, expiresAt: toDate(input.expiresAt).toISOString() }),
    );
    const url = new URL(
      `/api/stored-objects/uploads/${encodeURIComponent(input.objectId)}/content`,
      this.publicBaseUrl,
    );
    url.searchParams.set("sig", seal);

    return url.toString();
  }

  /** The claims, once the seal opens, names this object and has not lapsed. */
  open(input: { objectId: string; signature: string; now: Instant }): SealedUpload {
    const claims = this.claimsOf(input.signature);
    if (claims.objectId !== input.objectId) throw new UploadTokenInvalidError();

    const expiresAt = Temporal.Instant.from(claims.expiresAt);
    if (Temporal.Instant.compare(expiresAt, input.now) <= 0) throw new UploadExpiredError();

    return claims;
  }

  /** The same-origin path a browser GETs one object's bytes from, on every backend. */
  readPathFor(input: {
    projectId: string;
    objectId: string;
    filename?: string | undefined;
    expiresAt: Instant;
  }): string {
    const seal = this.encryption.encrypt(
      JSON.stringify({
        kind: "read",
        projectId: input.projectId,
        objectId: input.objectId,
        ...(input.filename ? { filename: input.filename } : {}),
        expiresAt: toDate(input.expiresAt).toISOString(),
      }),
    );
    const query = new URLSearchParams({ sig: seal });

    return `/api/stored-objects/${encodeURIComponent(input.objectId)}/content?${query}`;
  }

  /** A read seal that opens, names this object and has not lapsed; anything else is a 401. */
  openRead(input: { objectId: string; signature: string; now: Instant }): SealedRead {
    const claims = this.readClaimsOf(input.signature);
    if (claims.objectId !== input.objectId) throw new UnauthorizedError("unauthenticated");

    const expiresAt = Temporal.Instant.from(claims.expiresAt);
    if (Temporal.Instant.compare(expiresAt, input.now) <= 0) {
      throw new UnauthorizedError("unauthenticated");
    }

    return claims;
  }

  private readClaimsOf(signature: string): SealedRead {
    try {
      return sealedReadSchema.parse(JSON.parse(this.encryption.decrypt(signature)));
    } catch {
      throw new UnauthorizedError("unauthenticated");
    }
  }

  private claimsOf(signature: string): SealedUpload {
    try {
      return sealedUploadSchema.parse(JSON.parse(this.encryption.decrypt(signature)));
    } catch {
      throw new UploadTokenInvalidError();
    }
  }
}
