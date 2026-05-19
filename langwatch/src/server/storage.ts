import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import { env } from "../env.mjs";
import { getS3ConfigForProject } from "./dataplane-s3";
import { resolveProjectStorageDestination } from "./stored-objects/project-storage-destination";

export class StorageService {
  private async getLocalStoragePath(projectId: string, key: string) {
    // Make sure projectId and key don't contain path traversal characters
    if (projectId.includes("..") || key.includes("..")) {
      throw new Error(
        "Invalid projectId or key: path traversal attempt detected",
      );
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
  const s3Bucket =
    destination.kind === "s3" ? destination.bucket : "langwatch";

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
  const accessKeyId =
    privateConfig?.accessKeyId ?? env.S3_ACCESS_KEY_ID;
  const secretAccessKey =
    privateConfig?.secretAccessKey ?? env.S3_SECRET_ACCESS_KEY;
  const sessionToken = env.S3_SESSION_TOKEN;
  const hasExplicitKeys = !!(accessKeyId && secretAccessKey);

  // Region resolution. "auto" is the R2 / MinIO convention and works for
  // those + any S3-compatible endpoint that ignores region. Real AWS S3
  // requires the actual bucket region for SigV4 to verify, so the
  // S3_REGION env override is the escape hatch for AWS deployments.
  const region = env.S3_REGION ?? "auto";

  const s3Client = new S3Client({
    region,
    endpoint: privateConfig?.endpoint ?? env.S3_ENDPOINT,
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
