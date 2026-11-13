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

interface S3Place {
  readonly client: S3Client;
  readonly bucket: string;
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
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: {
      connectionTimeout: S3_CONNECTION_TIMEOUT_MS,
      socketTimeout: S3_SOCKET_IDLE_TIMEOUT_MS,
      throwOnRequestTimeout: true,
    },
  });
}

/**
 * A stalled socket fails the call instead of holding one of the pool's sockets forever. The
 * handler arms the idle timeout only on a request still waiting 3s in; an upload body that
 * stops for a minute is cut, and `readObject` arms the same timeout on the body it returns.
 */
const S3_CONNECTION_TIMEOUT_MS = 5_000;
export const S3_SOCKET_IDLE_TIMEOUT_MS = 60_000;
/**
 * Until response headers, socket wait in the pool included, per attempt: the SDK retries a
 * timeout, so a stalled call fails after about three of these. PUT carries none: its clock
 * would include the upload body.
 */
const S3_ANSWER_DEADLINE = { requestTimeout: 30_000 } as const;

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
    );
  } catch (error) {
    throw measured.failure() ?? error;
  }
  return measured.digest();
}

async function readObject(place: S3Place, at: StoredObjectAddress): Promise<Readable> {
  try {
    const response = await place.client.send(
      new GetObjectCommand({ Bucket: place.bucket, Key: at.key }),
      S3_ANSWER_DEADLINE,
    );
    if (response.Body instanceof Readable) return releasedWhenIdle(response.Body);
    throw new Error(`S3 answered "${at.key}" without a readable body.`);
  } catch (error) {
    if (isMissing(error)) throw new StoredObjectNotFoundError(at.projectId, at.key);
    throw error;
  }
}

/** A body nobody reads, or one S3 stops sending, gives its pooled socket back after a minute. */
function releasedWhenIdle(body: Readable): Readable {
  if (body instanceof IncomingMessage) {
    body.setTimeout(S3_SOCKET_IDLE_TIMEOUT_MS, () => {
      body.destroy(Object.assign(new Error("S3 body went idle"), { name: "TimeoutError" }));
    });
  }
  return body;
}

/** S3's own full-object SHA-256 where the object carries one; otherwise nothing. */
async function heldDigest(
  place: S3Place,
  at: StoredObjectAddress,
): Promise<ObjectDigest | undefined> {
  try {
    const head = await place.client.send(
      new HeadObjectCommand({ Bucket: place.bucket, Key: at.key, ChecksumMode: "ENABLED" }),
      S3_ANSWER_DEADLINE,
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
}): ObjectBackend {
  const place: S3Place = { client: options.client, bucket: options.bucket };
  return {
    destination: { kind: "s3", bucket: place.bucket },
    write: (at, body, facts) => writeObject({ place, at, body, facts }),
    read: (at) => readObject(place, at),
    digest: async (at) => (await heldDigest(place, at)) ?? digestOf(await readObject(place, at)),
    async remove(at) {
      await place.client.send(
        new DeleteObjectCommand({ Bucket: place.bucket, Key: at.key }),
        S3_ANSWER_DEADLINE,
      );
    },
    signUpload: (at, facts) => signObjectUpload({ ...place, clock: options.clock }, at, facts),
    signDownload: (at, facts) => signObjectDownload({ ...place, clock: options.clock }, at, facts),
    async probe() {
      await place.client.send(new HeadBucketCommand({ Bucket: place.bucket }), S3_ANSWER_DEADLINE);
    },
  };
}
