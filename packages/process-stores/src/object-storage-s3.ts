/**
 * S3 and S3-compatible storage as one placed backend: streamed PUT and GET,
 * and an upload URL whose signature covers content-type and content-length.
 */
import { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { fromTokenFile } from "@aws-sdk/credential-providers";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3RegionFor, s3RegionOf, type S3BucketRegionAnswer } from "@langwatch/aws-client";

import type { ObjectStorageAccount, ObjectStorageUploads } from "./config.ts";
import type {
  Clock,
  DownloadFacts,
  ObjectBodyFacts,
  ObjectDigest,
  SignedObjectUpload,
  StoredObjectAddress,
  UploadFacts,
} from "./members.ts";
import {
  digestOf,
  measureBody,
  secondsUntil,
  StoredObjectNotFoundError,
  type ObjectBackend,
  uploadRouteOf,
} from "./object-storage-backend.ts";

const SIGNED_UPLOAD_HEADERS = new Set(["content-type", "content-length"]);

/** No socket idles past this, so a stalled transfer is cut and its socket freed. */
const S3_IDLE_MS = 120_000;

/**
 * Every call ends: connect within 5 s, an answer's headers within 60 s (a wait for a free
 * socket included), an idle upload within S3_IDLE_MS. A transfer that keeps moving is never
 * cut (tasks#1173).
 */
const S3_REQUEST_HANDLER = {
  connectionTimeout: 5_000,
  requestTimeout: 60_000,
  throwOnRequestTimeout: true,
  socketTimeout: S3_IDLE_MS,
} as const;

interface S3Place {
  readonly client: S3Client;
  readonly bucket: string;
  readonly bodyIdleMs: number;
}

/** What a client may be handed instead of asking AWS, so a test can answer for it. */
export interface S3RegionSeams {
  readonly askBucket?: () => Promise<S3BucketRegionAnswer>;
  readonly configured?: () => Promise<string | undefined>;
}

/**
 * One client per account. Checksums only when an operation requires one: a
 * default trailer checksum breaks presigned PUTs and most non-AWS endpoints.
 * With no region named anywhere, the bucket's own region is asked once (tasks#1192).
 */
export function s3Client(account: ObjectStorageAccount, seams: S3RegionSeams = {}): S3Client {
  const endpoint = account.endpoint?.trim() || undefined;
  const credentials = credentialsOf(account);

  return new S3Client({
    region: s3RegionFor({
      region: account.region,
      endpoint,
      bucket: account.bucket,
      askBucket: seams.askBucket ?? (() => askOnce(account)),
      configured: seams.configured,
    }),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(credentials === undefined ? {} : { credentials }),
    forcePathStyle: account.forcePathStyle ?? true,
    requestHandler: S3_REQUEST_HANDLER,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function credentialsOf(account: ObjectStorageAccount) {
  return account.roleArn
    ? fromTokenFile({ roleArn: account.roleArn })
    : account.credentials && { ...account.credentials };
}

/** One question from a client of its own, closed afterwards so its sockets do not linger. */
async function askOnce(account: ObjectStorageAccount): Promise<S3BucketRegionAnswer> {
  const client = bucketRegionClient(account);
  try {
    return await bucketRegionOf({ client, bucket: account.bucket });
  } finally {
    client.destroy();
  }
}

/** AWS's us-east-1 endpoint, one attempt, the store's timeouts: it only asks where a bucket is. */
function bucketRegionClient(account: ObjectStorageAccount): S3Client {
  const credentials = credentialsOf(account);
  return new S3Client({
    region: s3RegionOf({ region: "us-east-1" }),
    ...(credentials === undefined ? {} : { credentials }),
    forcePathStyle: true,
    maxAttempts: 1,
    requestHandler: S3_REQUEST_HANDLER,
  });
}

/** AWS names a bucket's region on success, a redirect and a refusal alike; 404 is no bucket. */
export async function bucketRegionOf({
  client,
  bucket,
}: {
  client: S3Client;
  bucket: string;
}): Promise<S3BucketRegionAnswer> {
  try {
    const answer = await client.send(new HeadBucketCommand({ Bucket: bucket }));
    const region = answer.BucketRegion ?? (await client.config.region());
    return { kind: "found", region };
  } catch (error) {
    if (!(error instanceof S3ServiceException)) return { kind: "unknown", cause: error };
    const named = error.$response?.headers?.["x-amz-bucket-region"]?.trim();
    if (named) return { kind: "found", region: named };
    if (error.$metadata.httpStatusCode === 404) return { kind: "missing" };
    return { kind: "unknown", cause: error };
  }
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  const missingName = error.name === "NoSuchKey" || error.name === "NotFound";
  return missingName || error.$metadata.httpStatusCode === 404;
}

async function writeObject(options: {
  place: S3Place;
  at: StoredObjectAddress;
  body: AsyncIterable<Uint8Array>;
  facts: ObjectBodyFacts;
}): Promise<ObjectDigest> {
  const { place, at, body, facts } = options;
  const measured = measureBody({ at, body, facts });
  try {
    await place.client.send(
      new PutObjectCommand({
        Bucket: place.bucket,
        Key: at.key,
        Body: Readable.from(measured.chunks, { objectMode: false }),
        ContentLength: facts.byteLength,
        ContentType: facts.contentType,
      }),
      // The answer comes once the whole body is sent, so a wall clock would cap the upload's size.
      // The handler's socketTimeout still cuts an upload that stops moving for S3_IDLE_MS.
      { requestTimeout: 0 },
    );
  } catch (error) {
    throw measured.failure() ?? error;
  }
  return measured.digest();
}

/**
 * The SDK drops its own idle timer once an answer's headers arrive, so a body that then stalls,
 * or is never read, would hold its socket for good: the body carries its own idle limit.
 */
function idleBounded(body: Readable, key: string, idleMs: number): Readable {
  if (!(body instanceof IncomingMessage)) return body;
  body.setTimeout(idleMs, () => {
    const stalled = new Error(
      `No bytes of "${key}" moved for ${idleMs} ms, so the body was closed to free its connection.`,
    );
    body.destroy(
      Object.assign(stalled, { name: "TimeoutError", code: "storage_body_idle_timeout" }),
    );
  });
  return body;
}

async function readObject(place: S3Place, at: StoredObjectAddress): Promise<Readable> {
  try {
    const response = await place.client.send(
      new GetObjectCommand({ Bucket: place.bucket, Key: at.key }),
    );
    if (response.Body instanceof Readable) {
      return idleBounded(response.Body, at.key, place.bodyIdleMs);
    }
    throw new Error(`S3 answered "${at.key}" without a readable body.`);
  } catch (error) {
    if (isMissing(error)) throw new StoredObjectNotFoundError(at.projectId, at.key);
    throw error;
  }
}

async function objectExists(place: S3Place, at: StoredObjectAddress): Promise<boolean> {
  try {
    await place.client.send(new HeadObjectCommand({ Bucket: place.bucket, Key: at.key }));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** S3's own full-object SHA-256 where the object carries one; otherwise nothing. */
async function heldDigest(
  place: S3Place,
  at: StoredObjectAddress,
): Promise<ObjectDigest | undefined> {
  try {
    const head = await place.client.send(
      new HeadObjectCommand({ Bucket: place.bucket, Key: at.key, ChecksumMode: "ENABLED" }),
    );
    const { ChecksumSHA256: checksum, ChecksumType: type, ContentLength: byteLength } = head;
    if (checksum === undefined || type !== "FULL_OBJECT" || byteLength === undefined) {
      return undefined;
    }
    return { byteLength, sha256: Buffer.from(checksum, "base64").toString("hex") };
  } catch (error) {
    if (isMissing(error)) throw new StoredObjectNotFoundError(at.projectId, at.key);
    throw error;
  }
}

async function signObjectUpload(
  place: S3Place & { clock: Clock },
  at: StoredObjectAddress,
  facts: UploadFacts,
): Promise<SignedObjectUpload> {
  const expiresIn = secondsUntil({ expiresAt: facts.expiresAt, now: place.clock.now() });
  const url = await getSignedUrl(
    place.client,
    new PutObjectCommand({
      Bucket: place.bucket,
      Key: at.key,
      ContentType: facts.contentType,
      ContentLength: facts.byteLength,
    }),
    { expiresIn, signableHeaders: SIGNED_UPLOAD_HEADERS },
  );
  return { kind: "direct", url, headers: { "content-type": facts.contentType } };
}

async function signObjectDownload(
  place: S3Place & { clock: Clock },
  at: StoredObjectAddress,
  facts: DownloadFacts,
): Promise<string> {
  const expiresIn = secondsUntil({ expiresAt: facts.expiresAt, now: place.clock.now() });
  return getSignedUrl(place.client, new GetObjectCommand({ Bucket: place.bucket, Key: at.key }), {
    expiresIn,
  });
}

export function s3Backend(options: {
  client: S3Client;
  bucket: string;
  clock: Clock;
  bodyIdleMs?: number;
  /** `through-langwatch` hands out the process's own route and signs no bucket URL. */
  uploads?: ObjectStorageUploads;
}): ObjectBackend {
  const place: S3Place = {
    client: options.client,
    bucket: options.bucket,
    bodyIdleMs: options.bodyIdleMs ?? S3_IDLE_MS,
  };
  const uploadRoute = uploadRouteOf(options.uploads);
  return {
    destination: { kind: "s3", bucket: place.bucket },
    write: (at, body, facts) => writeObject({ place, at, body, facts }),
    read: (at) => readObject(place, at),
    exists: (at) => objectExists(place, at),
    digest: async (at) => (await heldDigest(place, at)) ?? digestOf(await readObject(place, at)),
    async remove(at) {
      await place.client.send(new DeleteObjectCommand({ Bucket: place.bucket, Key: at.key }));
    },
    signUpload: async (at, facts) =>
      uploadRoute === "through-process"
        ? { kind: "through-process" }
        : signObjectUpload({ ...place, clock: options.clock }, at, facts),
    uploadRoute,
    signDownload: (at, facts) => signObjectDownload({ ...place, clock: options.clock }, at, facts),
    async probe() {
      await place.client.send(new HeadBucketCommand({ Bucket: place.bucket }));
    },
  };
}
