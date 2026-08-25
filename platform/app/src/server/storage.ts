import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import { env } from "../env.mjs";
import { getS3ConfigForProject } from "./dataplane-s3";
import { resolveProjectStorageDestination } from "./stored-objects/project-storage-destination";

export class StorageService {
  private async getLocalStoragePath(projectId: string, key: string) {
    // Make sure projectId and key don't contain path traversal characters
    if (projectId.includes("..") || key.includes("..")) {
      throw new Error("Invalid projectId or key: path traversal attempt detected");
    }
    const storageDir =
      process.env.LOCAL_STORAGE_PATH ?? path.resolve(process.cwd(), "storage");
    const fullPath = path.join(storageDir, projectId, key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    return fullPath;
  }

  async putObject(
    projectId: string,
    datasetId: string,
    data: string | Buffer,
  ): Promise<void> {
    if (env.DATASET_STORAGE_LOCAL) {
      const filePath = await this.getLocalStoragePath(projectId, datasetId);
      await fs.writeFile(filePath, data as string);
    } else {
      const { s3Client, s3Bucket } = await createS3Client(projectId);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: s3Bucket,
          Key: `datasets/${projectId}/${datasetId}`,
          Body: data,
          ContentType: "application/json",
        }),
      );
    }
  }

  async getObject(
    projectId: string,
    datasetId: string,
  ): Promise<{ records: any[]; count: number }> {
    if (env.DATASET_STORAGE_LOCAL) {
      const filePath = await this.getLocalStoragePath(projectId, datasetId);
      try {
        const fileContent = await fs.readFile(filePath, "utf-8");
        try {
          const json = JSON.parse(fileContent);
          return {
            records: json,
            count: json.length,
          };
        } catch {
          return {
            records: [],
            count: 0,
          };
        }
      } catch (error: any) {
        if (error.code === "ENOENT") {
          await fs.writeFile(filePath, JSON.stringify([]), "utf-8");
          return {
            records: [],
            count: 0,
          };
        }
        throw error;
      }
    } else {
      const { s3Client, s3Bucket } = await createS3Client(projectId);

      try {
        const { Body } = await s3Client.send(
          new GetObjectCommand({
            Bucket: s3Bucket,
            Key: `datasets/${projectId}/${datasetId}`,
          }),
        );
        const content = await Body?.transformToString();
        const json = JSON.parse(content ?? "[]");
        return {
          records: json,
          count: json.length,
        };
      } catch (error: any) {
        if (error.name === "NoSuchKey") {
          return {
            records: [],
            count: 0,
          };
        }
        throw error;
      }
    }
  }
}

export const createS3Client = async (projectId: string) => {
  // Bucket selection routes through the shared
  // `resolveProjectStorageDestination` so dataset uploads and
  // stored-objects writes never drift on the BYOC → env → fallback
  // precedence. The dataset code path is only reachable when the caller
  // has decided S3 is appropriate (DATASET_STORAGE_LOCAL=false); a
  // file-destination return here means the operator asked for S3 without
  // configuring it, which we preserve as the historical hardcoded
  // "langwatch" bucket to avoid silently rebinding to /var/lib/langwatch.
  const destination = await resolveProjectStorageDestination(projectId);

  // This factory only ever speaks the S3 wire protocol, and it serves two
  // different kinds of caller: URI-driven readers (S3Driver — bucket comes
  // from the persisted s3:// URI) and legacy bucket+key surfaces (the edge
  // spool, payload staging, legacy dataset JSON) that read back exactly
  // what they wrote. An azure destination (STORED_OBJECTS_BACKEND=azure)
  // must therefore NOT blanket-throw here: a deployment migrating S3→Azure
  // keeps legacy s3:// URIs and spool refs that must stay readable and
  // deletable. While S3_BUCKET_NAME is still configured, the legacy
  // surfaces keep using it — each one reads what it writes, so nothing is
  // silently lost. Only when the install is azure-only (no S3 bucket at
  // all) do we fail loud: there is no legacy S3 data to read, and
  // inventing a client against the hardcoded "langwatch" fallback would
  // silently write bytes nobody reads back.
  let s3Bucket: string;
  if (destination.kind === "azure") {
    const legacyBucket = env.S3_BUCKET_NAME?.trim();
    if (!legacyBucket) {
      throw new Error(
        `createS3Client cannot serve project ${projectId}: the resolved storage destination is the azure backend (STORED_OBJECTS_BACKEND=azure) and no S3_BUCKET_NAME is configured. Legacy S3 surfaces (spool, staging, legacy datasets) are unavailable on an azure-only install — use the Azure dataset/stored-objects storage implementations instead.`,
      );
    }
    s3Bucket = legacyBucket;
  } else {
    s3Bucket = destination.kind === "s3" ? destination.bucket : "langwatch";
  }

  // Endpoint + credentials still come from the BYOC config (per-project)
  // or env (global). The resolver above only commits to the bucket
  // choice; the rest of the connection details ride alongside.
  const privateConfig = await getS3ConfigForProject(projectId);

  // Credentials precedence:
  //   1. BYOC config (per-project, set by tenant)
  //   2. env vars (S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY [+ S3_SESSION_TOKEN])
  //   3. SDK default provider chain — IRSA (EKS service-account web identity
  //      token), EC2 instance profile, ECS task role, ~/.aws/credentials,
  //      etc. Reached only when neither (1) nor (2) provides a key.
  //
  // Pre-PR-4058 the credentials field was always set even when env vars
  // were empty strings, which short-circuited the default chain and broke
  // IRSA in production EKS deployments. This branch passes credentials
  // ONLY when an explicit access-key + secret pair is present, letting the
  // SDK fall back through its default chain for keyless modes.
  const accessKeyId = privateConfig?.accessKeyId ?? env.S3_ACCESS_KEY_ID;
  const secretAccessKey = privateConfig?.secretAccessKey ?? env.S3_SECRET_ACCESS_KEY;
  const sessionToken = env.S3_SESSION_TOKEN;
  const hasExplicitKeys = !!(accessKeyId && secretAccessKey);

  // Region resolution:
  //   - If S3_REGION is explicitly set, use it.
  //   - If endpoint is non-AWS (R2, MinIO, custom host), keep "auto" — those operators rely on it.
  //   - If endpoint is AWS (absent or *.amazonaws.com) AND no explicit keys
  //     (IRSA path) → pass undefined so the SDK resolves region from its
  //     chain (IRSA injects AWS_REGION into the EKS pod env).
  //   - If endpoint is AWS AND explicit keys → fall back to "auto" to preserve
  //     the pre-PR-4058 behavior for ops tooling / local env with hardcoded keys.
  const endpoint = privateConfig?.endpoint ?? env.S3_ENDPOINT;
  const isAwsEndpoint = !endpoint || endpoint.endsWith(".amazonaws.com");
  const region: string | undefined =
    env.S3_REGION ?? (isAwsEndpoint && !hasExplicitKeys ? undefined : "auto");

  const s3Client = new S3Client({
    ...(region !== undefined ? { region } : {}),
    endpoint,
    ...(hasExplicitKeys
      ? {
          credentials: {
            accessKeyId: accessKeyId!,
            secretAccessKey: secretAccessKey!,
            ...(sessionToken ? { sessionToken } : {}),
          },
        }
      : {}),
    forcePathStyle: true,
  });

  return { s3Client, s3Bucket };
};
