import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";

/**
 * Reference to a trace field value offloaded to object storage. Stored inline
 * (alongside a bounded preview) in place of an over-threshold span attribute
 * value, so the queue job / fold cache / ClickHouse rows stay small. The full
 * value is fetched from S3 only on the rare read that needs it (eval, "open
 * full"). See ADR-021 and issue #4215.
 */
export interface TraceBlobRef {
  /** Positional, project-scoped key inside the org-resolved bucket. */
  key: string;
  /** UTF-8 byte length of the original value. */
  size: number;
  /** SHA-256 of the original bytes — doubles as an integrity check on read. */
  sha256: string;
  encoding: "utf-8";
}

export interface S3ClientResolution {
  s3Client: S3Client;
  s3Bucket: string;
}

/** Resolves the per-organization S3 client + bucket for a project. */
export type S3ClientResolver = (
  projectId: string,
) => Promise<S3ClientResolution>;

export class BlobIntegrityError extends Error {
  constructor(
    readonly key: string,
    readonly expectedSha256: string,
    readonly actualSha256: string,
  ) {
    super(
      `Blob integrity check failed for ${key}: expected ${expectedSha256}, got ${actualSha256}`,
    );
    this.name = "BlobIntegrityError";
  }
}

/**
 * Stores large trace field values in object storage, one object per field.
 *
 * Key shape: `trace-blobs/{projectId}/{traceId}/{spanId}/{attrKey}` — positional
 * (not content-hashed: trivial prefix-delete GC). The org bucket is resolved via
 * the injected `S3ClientResolver`; in per-org BYOC deployments each org has its
 * own bucket and cross-org access is gated at the bucket boundary. In shared-bucket
 * deployments (no BYOC configured), isolation is **API-enforced**: callers MUST
 * pass their authenticated `projectId`, which is encoded into the key prefix.
 * A caller cannot construct another project's key without already knowing that
 * project's (traceId, spanId) AND being authorized to address it. There is no
 * in-process ACL inside `BlobStore.get` — that is the auth layer's job at the
 * request boundary.
 */
export class BlobStore {
  constructor(private readonly resolveS3Client: S3ClientResolver) {}

  static blobKey({
    projectId,
    traceId,
    spanId,
    attrKey,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    attrKey: string;
  }): string {
    for (const part of [projectId, traceId, spanId, attrKey]) {
      if (part.includes("..")) {
        throw new Error(
          `Invalid blob key component (path traversal): ${part}`,
        );
      }
    }
    // attrKey (e.g. "langwatch.output") is dotted but never contains slashes;
    // encode defensively so an unexpected value can't escape the prefix.
    const safeAttr = encodeURIComponent(attrKey);
    return `trace-blobs/${projectId}/${traceId}/${spanId}/${safeAttr}`;
  }

  async put({
    projectId,
    traceId,
    spanId,
    attrKey,
    value,
  }: {
    projectId: string;
    traceId: string;
    spanId: string;
    attrKey: string;
    value: string;
  }): Promise<TraceBlobRef> {
    const body = Buffer.from(value, "utf-8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    const key = BlobStore.blobKey({ projectId, traceId, spanId, attrKey });
    const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: body,
        ContentType: "text/plain; charset=utf-8",
      }),
    );
    return { key, size: body.byteLength, sha256, encoding: "utf-8" };
  }

  async get({
    projectId,
    ref,
  }: {
    projectId: string;
    ref: TraceBlobRef;
  }): Promise<string> {
    const { s3Client, s3Bucket } = await this.resolveS3Client(projectId);
    const { Body } = await s3Client.send(
      new GetObjectCommand({ Bucket: s3Bucket, Key: ref.key }),
    );
    const content = (await Body?.transformToString("utf-8")) ?? "";
    const actual = createHash("sha256")
      .update(Buffer.from(content, "utf-8"))
      .digest("hex");
    if (actual !== ref.sha256) {
      throw new BlobIntegrityError(ref.key, ref.sha256, actual);
    }
    return content;
  }
}
