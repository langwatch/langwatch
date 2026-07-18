import { S3Client } from "@aws-sdk/client-s3";

import { env } from "~/env.mjs";
import { createS3Client } from "~/server/storage";
import { LocalFilesystemDriver } from "~/server/stored-objects/local-filesystem-driver";
import {
  type ProjectStorageDestination,
  resolveProjectStorageDestination,
} from "~/server/stored-objects/project-storage-destination";
import { S3Driver } from "~/server/stored-objects/s3-driver";
import { StorageRegistry } from "~/server/stored-objects/storage-registry";
import { createStorageRegistry } from "~/server/stored-objects/stored-objects-factory";
import { mintFileUri, mintS3Uri } from "~/server/stored-objects/uri";

const DEFAULT_QUEUE_PAYLOAD_PREFIX = "temp-tier-3-offload/";

export type GroupQueueStorageDestination =
  | { kind: "s3"; bucket: string; prefix?: string }
  | Extract<ProjectStorageDestination, { kind: "file" }>;

function queuePayloadBucket(): string | undefined {
  return env.LANGWATCH_QUEUE_PAYLOAD_BUCKET?.trim() || undefined;
}

function queuePayloadPrefix(): string {
  const prefix =
    env.LANGWATCH_QUEUE_PAYLOAD_PREFIX?.trim() || DEFAULT_QUEUE_PAYLOAD_PREFIX;
  return `${prefix.replace(/^\/+|\/+$/g, "")}/`;
}

/** Resolve the dedicated queue destination without consulting tenant BYOC. */
export async function resolveGroupQueueStorageDestination(
  projectId: string,
): Promise<GroupQueueStorageDestination> {
  const bucket = queuePayloadBucket();
  if (bucket) {
    return { kind: "s3", bucket, prefix: queuePayloadPrefix() };
  }
  return resolveProjectStorageDestination(projectId);
}

/** Mint the queue key under its lifecycle-managed prefix. */
export function mintGroupQueueStorageUri({
  destination,
  tenantId,
  hash,
}: {
  destination: GroupQueueStorageDestination;
  tenantId: string;
  hash: string;
}): string {
  if (destination.kind === "file") {
    return mintFileUri({
      root: destination.root,
      projectId: tenantId,
      sha256: hash,
    });
  }
  if (destination.prefix) {
    return `s3://${destination.bucket}/${destination.prefix}${tenantId}/${hash}`;
  }
  return mintS3Uri({
    bucket: destination.bucket,
    projectId: tenantId,
    sha256: hash,
  });
}

/** Build a queue-only S3 client from deployment credentials, never BYOC. */
export async function createGroupQueueS3Client(projectId: string) {
  const bucket = queuePayloadBucket();
  if (!bucket) return createS3Client(projectId);

  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  const sessionToken = env.S3_SESSION_TOKEN;
  const hasExplicitKeys = !!(accessKeyId && secretAccessKey);
  const endpoint = env.LANGWATCH_QUEUE_PAYLOAD_S3_ENDPOINT;
  const isAwsEndpoint = !endpoint || endpoint.endsWith(".amazonaws.com");
  const region =
    env.S3_REGION ?? (isAwsEndpoint && !hasExplicitKeys ? undefined : "auto");

  const s3Client = new S3Client({
    ...(region !== undefined ? { region } : {}),
    endpoint,
    ...(hasExplicitKeys
      ? {
          credentials: {
            accessKeyId,
            secretAccessKey,
            ...(sessionToken ? { sessionToken } : {}),
          },
        }
      : {}),
    forcePathStyle: true,
  });

  return { s3Client, s3Bucket: bucket };
}

export function createGroupQueueStorageRegistry({
  projectId,
}: {
  projectId: string;
}): StorageRegistry {
  if (!queuePayloadBucket()) return createStorageRegistry({ projectId });

  return new StorageRegistry({
    s3: new S3Driver(projectId, createGroupQueueS3Client),
    file: new LocalFilesystemDriver(),
  });
}
