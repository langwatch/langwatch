/**
 * The local backend's upload URL: claims sealed by the process's `encryption`
 * member (AES-256-GCM, whose seal is its own signature). ADR-158 §4.
 */
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

  private claimsOf(signature: string): SealedUpload {
    try {
      return sealedUploadSchema.parse(JSON.parse(this.encryption.decrypt(signature)));
    } catch {
      throw new UploadTokenInvalidError();
    }
  }
}
