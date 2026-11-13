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

import type { ObjectStorageAccount } from "./config.ts";
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

/**
 * One client per account. Checksums only when an operation requires one: a
 * default trailer checksum breaks presigned PUTs and most non-AWS endpoints.
 */
export function s3Client(account: ObjectStorageAccount): S3Client {
  const endpoint = account.endpoint?.trim() || undefined;
  const roleArn = account.roleArn;
  const staticCredentials = roleArn ? undefined : account.credentials;
  const isAwsEndpoint = endpoint === undefined || isAwsHost(endpoint);
  const region = account.region ?? (isAwsEndpoint && !staticCredentials ? undefined : "auto");
  const credentials = roleArn
    ? fromTokenFile({ roleArn })
    : staticCredentials && { ...staticCredentials };

  return new S3Client({
    ...(region === undefined ? {} : { region }),
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(credentials === undefined ? {} : { credentials }),
    forcePathStyle: account.forcePathStyle ?? true,
    requestHandler: S3_REQUEST_HANDLER,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * Reads the endpoint's hostname, so a trailing slash, path or port still counts
 * as AWS. A bare host without a scheme is read as https.
 */
function isAwsHost(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`).hostname;
  } catch {
    return false;
  }
  return host.endsWith(".amazonaws.com") || host.endsWith(".amazonaws.com.cn");
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
    const stalled = new Error(`S3 sent no bytes of "${key}" for ${idleMs} ms.`);
    body.destroy(Object.assign(stalled, { name: "TimeoutError" }));
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
}): ObjectBackend {
  const place: S3Place = {
    client: options.client,
    bucket: options.bucket,
    bodyIdleMs: options.bodyIdleMs ?? S3_IDLE_MS,
  };
  return {
    destination: { kind: "s3", bucket: place.bucket },
    write: (at, body, facts) => writeObject({ place, at, body, facts }),
    read: (at) => readObject(place, at),
    exists: (at) => objectExists(place, at),
    digest: async (at) => (await heldDigest(place, at)) ?? digestOf(await readObject(place, at)),
    async remove(at) {
      await place.client.send(new DeleteObjectCommand({ Bucket: place.bucket, Key: at.key }));
    },
    signUpload: (at, facts) => signObjectUpload({ ...place, clock: options.clock }, at, facts),
    signDownload: (at, facts) => signObjectDownload({ ...place, clock: options.clock }, at, facts),
    async probe() {
      await place.client.send(new HeadBucketCommand({ Bucket: place.bucket }));
    },
  };
}
