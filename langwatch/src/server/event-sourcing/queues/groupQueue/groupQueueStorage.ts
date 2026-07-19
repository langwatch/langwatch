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

/**
 * A queue destination always carries the prefix its payloads live under.
 *
 * Durable-tier bytes are NOT reclaimed by lease release — leases only govern
 * the Redis tier, and durable bytes reclaim through the storage lifecycle
 * (ADR-030 lifecycle amendment). That delegation only holds if every durable
 * payload lands somewhere a lifecycle rule can actually name, so the prefix is
 * a property of the payload rather than of whether `LANGWATCH_QUEUE_PAYLOAD_BUCKET`
 * happens to be set. Writing at the destination root would put ephemeral queue
 * payloads beside `stored_objects` content — which has no `stored_objects` row
 * to be swept by, is retained deliberately, and is what a root-prefix lifecycle
 * rule would therefore have to spare.
 */
export type GroupQueueStorageDestination =
  | { kind: "s3"; bucket: string; prefix: string }
  | (Extract<ProjectStorageDestination, { kind: "file" }> & { prefix: string });

function queuePayloadBucket(): string | undefined {
  return env.LANGWATCH_QUEUE_PAYLOAD_BUCKET?.trim() || undefined;
}

function queuePayloadPrefix(): string {
  const prefix =
    env.LANGWATCH_QUEUE_PAYLOAD_PREFIX?.trim() || DEFAULT_QUEUE_PAYLOAD_PREFIX;
  return `${prefix.replace(/^\/+|\/+$/g, "")}/`;
}

/**
 * Resolve where this deployment's queue payloads live.
 *
 * A dedicated bucket keeps them off the tenant-content bucket entirely and is
 * the recommended production shape. Without one we fall back to the project
 * destination — including a tenant's BYOC bucket — but the queue prefix is
 * applied either way, so the fallback stays lifecycle-sweepable.
 */
export async function resolveGroupQueueStorageDestination(
  projectId: string,
): Promise<GroupQueueStorageDestination> {
  const prefix = queuePayloadPrefix();
  const bucket = queuePayloadBucket();
  if (bucket) {
    return { kind: "s3", bucket, prefix };
  }
  return { ...(await resolveProjectStorageDestination(projectId)), prefix };
}

/**
 * The prefix is required by the type, but a hand-built destination (a test
 * double, a future caller) can still reach here without one — and interpolating
 * an absent prefix would write to a literal `undefined…` key: not swept by the
 * lifecycle rule, not found by any reader, and silent. Fail loud instead.
 */
function requirePrefix(destination: GroupQueueStorageDestination): string {
  const prefix = destination.prefix?.trim();
  if (!prefix) {
    throw new Error(
      "GroupQueue storage destination is missing its payload prefix — " +
        "durable payloads must be namespaced so the lifecycle rule can reclaim them",
    );
  }
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
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
  const prefix = requirePrefix(destination);
  if (destination.kind === "file") {
    return mintFileUri({
      root: `${destination.root.replace(/\/+$/, "")}/${prefix.replace(/\/+$/, "")}`,
      projectId: tenantId,
      sha256: hash,
    });
  }
  return `s3://${destination.bucket}/${prefix}${tenantId}/${hash}`;
}

/**
 * Mint the pre-prefix location a payload would have been written at.
 *
 * Deployments without `LANGWATCH_QUEUE_PAYLOAD_BUCKET` wrote durable payloads at
 * the destination root until the prefix became unconditional. A decode miss is
 * not a retry — it discards the job permanently (#5538) — so the read path falls
 * back here rather than dropping in-flight work across the deploy that
 * introduces the prefix. Removable one release after that deploy, by which point
 * every legacy object is past the backstop window.
 */
export function mintLegacyGroupQueueStorageUri({
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
    s3: new S3Driver({
      projectId,
      clientFactory: createGroupQueueS3Client,
    }),
    file: new LocalFilesystemDriver(),
  });
}
