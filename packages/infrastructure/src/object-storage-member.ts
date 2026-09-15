/**
 * Blob storage as ONE client that routes itself.
 *
 * Every call names the project whose object it is, and this member resolves
 * the bucket, the endpoint and the credentials from it. There is no
 * `forProject` handing a caller a client, because a client a caller holds is a
 * client a caller can use for the wrong project one call later; the scope
 * travels with the operation instead.
 *
 * An organization that brings its own S3 account is routed to it. Every other
 * project writes to this deployment's shared bucket. A project this deployment
 * cannot place is refused, never written to the shared bucket by default:
 * putting one customer's objects where another customer's credentials reach
 * them is the failure this routing exists to prevent.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";
import type { ObjectStorageAccount, ObjectStorageConfig } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";
import type { ObjectStorage, StoredObject, StoredObjectAddress } from "./members.ts";
import type { TenantDirectory } from "./tenant-directory.ts";

/** A project whose organization this deployment cannot name. */
export class UnknownStorageProjectError extends Error {
  constructor(readonly projectId: string) {
    super(
      `Cannot store an object: project "${projectId}" has no known organization. ` +
        "Refusing to fall back to the shared bucket, which would put its objects " +
        "where another organization's credentials reach them.",
    );
    this.name = "UnknownStorageProjectError";
  }
}

export function buildObjectStorage(options: {
  config: ObjectStorageConfig;
  directory: TenantDirectory;
}): BuiltMember<ObjectStorage> {
  const { config, directory } = options;
  const shared = config.bucket.trim();
  if (!shared) throw new Error("Object storage was configured without a bucket name.");

  const accounts = new Map<string, ObjectStorageAccount>();
  for (const account of config.privateAccounts ?? []) {
    if (accounts.has(account.organizationId)) {
      throw new Error(
        `Two object-storage accounts are configured for organisation "${account.organizationId}".`,
      );
    }
    accounts.set(account.organizationId, account);
  }

  const clients = new Map<string, S3Client>();
  const clientFor = (account: ObjectStorageAccount): S3Client => {
    const key = [account.endpoint ?? "", account.region ?? "", account.bucket].join("|");
    const existing = clients.get(key);
    if (existing) return existing;

    const client = new S3Client({
      ...(account.region === undefined ? {} : { region: account.region }),
      ...(account.endpoint === undefined ? {} : { endpoint: account.endpoint }),
      ...(account.forcePathStyle === undefined ? {} : { forcePathStyle: account.forcePathStyle }),
      ...(account.credentials === undefined ? {} : { credentials: { ...account.credentials } }),
    });
    clients.set(key, client);
    return client;
  };

  /** Where this project's objects live, and which client reaches them. */
  const place = async (
    projectId: string,
  ): Promise<{ client: S3Client; bucket: string }> => {
    if (projectId === "") throw new UnknownStorageProjectError(projectId);
    if (accounts.size === 0) return { client: clientFor(config), bucket: shared };

    const organizationId = await directory.organizationForTenant(projectId);
    if (organizationId === null || organizationId === "") {
      throw new UnknownStorageProjectError(projectId);
    }
    const account = organizationId === PLATFORM_TENANT ? undefined : accounts.get(organizationId);
    return account === undefined
      ? { client: clientFor(config), bucket: shared }
      : { client: clientFor(account), bucket: account.bucket };
  };

  const storage: ObjectStorage = {
    async put(at: StoredObjectAddress, body, contentType) {
      const { client, bucket } = await place(at.projectId);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: at.key,
          Body: body,
          ...(contentType === undefined ? {} : { ContentType: contentType }),
        }),
      );
    },
    async find(at: StoredObjectAddress): Promise<StoredObject | undefined> {
      const { client, bucket } = await place(at.projectId);
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: at.key }));
        const body = await response.Body?.transformToByteArray();
        if (!body) return void 0;
        return { body, contentType: response.ContentType };
      } catch (error) {
        // An absent key is an answer, not a failure: every caller asks whether
        // the blob is there, and a throw here would make `find` unusable for
        // the question it is named after.
        if (error instanceof NoSuchKey) return void 0;
        throw error;
      }
    },
    async remove(at: StoredObjectAddress) {
      const { client, bucket } = await place(at.projectId);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: at.key }));
    },
  };

  return {
    value: storage,
    close: () => {
      for (const client of clients.values()) client.destroy();
      clients.clear();
      return Promise.resolve();
    },
  };
}
