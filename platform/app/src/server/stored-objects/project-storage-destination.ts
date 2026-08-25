import type { StoredObjectStorageDestination } from "@langwatch/stored-object-contract";
import { env } from "~/env.mjs";
import { getS3ConfigForProject } from "~/server/dataplane-s3";
import { resolveAzureCredentials } from "./azure-credentials";

export type ProjectStorageDestination = StoredObjectStorageDestination;

const DEFAULT_LOCAL_FS_ROOT = "/var/lib/langwatch/objects";

function resolveAzureDestination(): ProjectStorageDestination {
  const credentials = resolveAzureCredentials({ purpose: "write" });
  const container = env.AZURE_BLOB_CONTAINER;
  if (!container) {
    throw new Error("Azure storage destination is missing its validated container");
  }
  return {
    kind: "azure",
    accountName: credentials.accountName,
    container: container.trim(),
  };
}

/**
 * Resolves BYOC first, then an explicitly selected Azure backend, global S3,
 * and finally the documented single-replica local filesystem fallback.
 */
export async function resolveProjectStorageDestination(
  projectId: string,
): Promise<ProjectStorageDestination> {
  const privateConfig = await getS3ConfigForProject(projectId);
  if (privateConfig?.bucket) {
    return { kind: "s3", bucket: privateConfig.bucket };
  }
  if (env.STORED_OBJECTS_BACKEND === "azure") {
    return resolveAzureDestination();
  }
  const globalBucket = env.S3_BUCKET_NAME?.trim();
  if (globalBucket) {
    return { kind: "s3", bucket: globalBucket };
  }
  return {
    kind: "file",
    root: env.LANGWATCH_LOCAL_STORAGE_PATH ?? DEFAULT_LOCAL_FS_ROOT,
  };
}
