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
      env.LOCAL_STORAGE_PATH ?? path.resolve(process.cwd(), "storage");
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

  const s3Client = new S3Client({
    region: "auto",
    endpoint: privateConfig?.endpoint ?? env.S3_ENDPOINT!,
    credentials: {
      accessKeyId: privateConfig?.accessKeyId ?? env.S3_ACCESS_KEY_ID!,
      secretAccessKey:
        privateConfig?.secretAccessKey ?? env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });

  return { s3Client, s3Bucket };
};
