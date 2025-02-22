import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import fs from "fs/promises";
import path from "path";
import { prisma } from "./db";
import { env } from "../env.mjs";

export class StorageService {
  private async getLocalStoragePath(projectId: string, key: string) {
    const storageDir = process.env.LOCAL_STORAGE_PATH ?? "./storage";
    const fullPath = path.join(storageDir, projectId, key);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });

    return fullPath;
  }

  async putObject(
    projectId: string,
    datasetId: string,
    data: string | Buffer
  ): Promise<void> {
    if (env.DATASET_STORAGE_LOCAL) {
      const filePath = await this.getLocalStoragePath(projectId, datasetId);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, data as string);
    } else {
      const s3Client = await createS3Client(projectId);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: env.S3_BUCKET_NAME ?? "langwatch-storage-prod",
          Key: `datasets/${projectId}/${datasetId}`,
          Body: data,
          ContentType: "application/json",
        })
      );
    }
  }

  async getObject(projectId: string, datasetId: string): Promise<any> {
    if (env.DATASET_STORAGE_LOCAL) {
      console.log("Getting object from local storage");
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
          return Buffer.from(JSON.stringify([]));
        }
        throw error;
      }
    } else {
      const s3Client = await createS3Client(projectId);

      try {
        const { Body } = await s3Client.send(
          new GetObjectCommand({
            Bucket: env.S3_BUCKET_NAME ?? "langwatch-storage-prod",
            Key: `datasets/${projectId}/${datasetId}`,
          })
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
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const organization = await prisma.organization.findFirst({
    where: {
      teams: {
        some: {
          projects: {
            some: { id: projectId },
          },
        },
      },
    },
  });

  if (!organization) {
    throw new Error("Organization not found");
  }

  const s3Config = {
    endpoint:
      project.s3Endpoint ?? organization?.s3Endpoint ?? env.S3_ENDPOINT!,
    accessKeyId:
      project.s3AccessKeyId ??
      organization?.s3AccessKeyId ??
      env.S3_ACCESS_KEY_ID!,
    secretAccessKey:
      project.s3SecretAccessKey ??
      organization?.s3SecretAccessKey ??
      env.S3_SECRET_ACCESS_KEY!,
  };

  const s3Client = new S3Client({
    endpoint: s3Config.endpoint,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  if (!s3Client) {
    throw new Error("Failed to create S3 client");
  }

  return s3Client;
};
