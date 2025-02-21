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
    if (true) {
      const filePath = await this.getLocalStoragePath(projectId, datasetId);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, data);
    } else {
      const s3Client = await createS3Client(projectId);
      await s3Client.send(
        new PutObjectCommand({
          Bucket: "langwatch",
          Key: `datasets/${projectId}/${datasetId}`,
          Body: data,
          ContentType: "application/json",
        })
      );
    }
  }

  async getObject(projectId: string, datasetId: string): Promise<any> {
    if (true) {
      const filePath = await this.getLocalStoragePath(projectId, datasetId);
      try {
        const fileContent = await fs.readFile(filePath, "utf-8");
        try {
          const json = JSON.parse(fileContent);
          return json;
        } catch {
          return [];
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

      const { Body } = await s3Client.send(
        new GetObjectCommand({
          Bucket: "langwatch",
          Key: `datasets/${projectId}/${datasetId}`,
        })
      );

      const content = await Body?.transformToString();
      return JSON.parse(content ?? "[]");
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

  console.log("s3Client", s3Client);

  if (!s3Client) {
    throw new Error("Failed to create S3 client");
  }

  return s3Client;
};
