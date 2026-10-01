/**
 * Object storage as ONE client that routes itself: every call names the
 * project, and the member places it on the organization's own S3 account or
 * the shared backend. An unplaceable project is refused, never defaulted.
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { PLATFORM_TENANT } from "@langwatch/clickhouse-client";

import type { ObjectStorageConfig, ObjectStoragePrivateAccount } from "./config.ts";
import type { BuiltMember } from "./datastore-members.ts";
import type {
  Clock,
  ObjectStorage,
  ObjectStorageDestination,
  StoredObjectAddress,
} from "./members.ts";
import { resolveAzureCredentials } from "./object-storage-azure-credentials.ts";
import { azureBackend } from "./object-storage-azure.ts";
import {
  UnknownStorageProjectError,
  UnreachableStorageLocationError,
  type ObjectBackend,
} from "./object-storage-backend.ts";
import { filesystemBackend } from "./object-storage-filesystem.ts";
import { s3Backend, s3Client } from "./object-storage-s3.ts";
import type { TenantDirectory } from "./tenant-directory.ts";

type SharedPlace = Readonly<{ backend: ObjectBackend; s3?: S3Client }>;

function sharedBackend(options: {
  config: ObjectStorageConfig;
  clock: Clock;
  clients: S3Client[];
}): SharedPlace {
  const { config, clock, clients } = options;
  switch (config.backend) {
    case "s3": {
      const bucket = config.s3.bucket.trim();
      if (!bucket)
        throw new Error("Object storage selected S3 without a bucket name (S3_BUCKET_NAME).");
      const client = s3Client(config.s3);
      clients.push(client);
      return { backend: s3Backend({ client, bucket, clock }), s3: client };
    }
    case "azure":
      return {
        backend: azureBackend({ credentials: resolveAzureCredentials(config.azure), clock }),
      };
    case "file": {
      const root = config.root.trim();
      if (!root) throw new Error("Object storage selected the filesystem without a root.");
      return { backend: filesystemBackend({ root }) };
    }
  }
}

function sameDestination(left: ObjectStorageDestination, right: ObjectStorageDestination): boolean {
  switch (left.kind) {
    case "s3":
      return right.kind === "s3" && right.bucket === left.bucket;
    case "azure":
      return (
        right.kind === "azure" &&
        right.accountName === left.accountName &&
        right.container === left.container
      );
    case "file":
      return right.kind === "file" && right.root === left.root;
    case "memory":
      return right.kind === "memory";
  }
}

function privateBackends(options: {
  accounts: readonly ObjectStoragePrivateAccount[];
  clock: Clock;
  clients: S3Client[];
}): Map<string, ObjectBackend> {
  const backends = new Map<string, ObjectBackend>();
  for (const account of options.accounts) {
    if (backends.has(account.organizationId)) {
      throw new Error(
        `Two object-storage accounts are configured for organisation "${account.organizationId}".`,
      );
    }
    const client = s3Client(account);
    options.clients.push(client);
    backends.set(
      account.organizationId,
      s3Backend({ client, bucket: account.bucket, clock: options.clock }),
    );
  }
  return backends;
}

/** A recorded location's backend: one configured, or one reached without new credentials. */
function backendAt(options: {
  location: ObjectStorageDestination;
  configured: readonly ObjectBackend[];
  recorded: Map<string, ObjectBackend>;
  sharedS3: S3Client | undefined;
  clock: Clock;
}): ObjectBackend | undefined {
  const { location, recorded, sharedS3, clock } = options;
  const known = [...options.configured, ...recorded.values()];
  const held = known.find((backend) => sameDestination(backend.destination, location));
  if (held) return held;
  const reached = reachable({ location, sharedS3, clock });
  if (reached) recorded.set(JSON.stringify(location), reached);
  return reached;
}

function reachable(options: {
  location: ObjectStorageDestination;
  sharedS3: S3Client | undefined;
  clock: Clock;
}): ObjectBackend | undefined {
  const { location, sharedS3, clock } = options;
  if (location.kind === "file") return filesystemBackend({ root: location.root });
  if (location.kind === "s3" && sharedS3) {
    return s3Backend({ client: sharedS3, bucket: location.bucket, clock });
  }
  return undefined;
}

async function placeProject(options: {
  projectId: string;
  shared: ObjectBackend;
  accounts: ReadonlyMap<string, ObjectBackend>;
  directory: TenantDirectory;
}): Promise<ObjectBackend> {
  const { projectId, shared, accounts, directory } = options;
  if (projectId === "") throw new UnknownStorageProjectError(projectId);
  if (accounts.size === 0) return shared;
  const organizationId = await directory.organizationForTenant(projectId);
  if (organizationId === null || organizationId === "") {
    throw new UnknownStorageProjectError(projectId);
  }
  if (organizationId === PLATFORM_TENANT) return shared;
  return accounts.get(organizationId) ?? shared;
}

export function buildObjectStorage(options: {
  config: ObjectStorageConfig;
  directory: TenantDirectory;
  clock: Clock;
}): BuiltMember<ObjectStorage> {
  const { config, directory, clock } = options;
  const clients: S3Client[] = [];
  const { backend: shared, s3: sharedS3 } = sharedBackend({ config, clock, clients });
  const accounts = privateBackends({ accounts: config.privateAccounts ?? [], clock, clients });
  const recorded = new Map<string, ObjectBackend>();
  const configured = [shared, ...accounts.values()];

  const place = (projectId: string) => placeProject({ projectId, shared, accounts, directory });

  const locate = async (at: StoredObjectAddress): Promise<ObjectBackend> => {
    const placed = await place(at.projectId);
    if (!at.location || sameDestination(placed.destination, at.location)) return placed;
    const backend = backendAt({ location: at.location, configured, recorded, sharedS3, clock });
    if (!backend) throw new UnreachableStorageLocationError(at.location.kind, at.key);
    return backend;
  };

  const storage: ObjectStorage = {
    write: async (at, body, facts) => (await place(at.projectId)).write(at, body, facts),
    read: async (at) => (await locate(at)).read(at),
    digest: async (at) => (await locate(at)).digest(at),
    remove: async (at) => (await locate(at)).remove(at),
    signUpload: async (at, facts) => (await place(at.projectId)).signUpload(at, facts),
    signDownload: async (at, facts) => (await locate(at)).signDownload(at, facts),
    destination: async (projectId) => (await place(projectId)).destination,
    probe: async (projectId) => (await place(projectId)).probe(),
  };

  return {
    value: storage,
    close: () => {
      for (const client of clients) client.destroy();
      clients.length = 0;
      return Promise.resolve();
    },
  };
}
