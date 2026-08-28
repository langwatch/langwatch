import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { AwsClientProcessRuntime } from "@langwatch/aws-client";
import { getStoredObjectStorageScheme } from "@langwatch/stored-object-contract";
import {
  StoredObjectAzureDestinationPort,
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
  StoredObjectStorageRuntime,
  type StoredObjectStorageDriver,
  type StoredObjectStorageSelection,
} from "@langwatch/stored-object-server/storage";

export type WorkerS3Credentials = Readonly<{
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}>;

export type WorkerProjectS3Target = Readonly<{
  bucket: string;
  endpoint?: string;
  region?: string;
  credentials?: WorkerS3Credentials;
}>;

/** The physical Worker resolves the current project target for every operation. */
export abstract class WorkerProjectS3SourcePort extends StoredObjectProjectS3ConfigPort {
  abstract override tryGet(projectId: string): Promise<WorkerProjectS3Target | null>;
}

/** Azure stays lazy so an inactive or BYOC-first deployment never constructs it. */
export abstract class WorkerAzureStorageFactoryPort extends StoredObjectAzureDestinationPort {
  abstract createDriver(): StoredObjectStorageDriver | undefined;
}

export type WorkerStoredObjectStorageConfig = Readonly<{
  backend: "azure" | "s3" | "file";
  localFilesystemRoot: string;
  globalS3?: WorkerProjectS3Target;
  azure?: WorkerAzureStorageFactoryPort;
}>;

/**
 * Production storage composition for the eventual Worker executable.
 *
 * It deliberately accepts semantic configuration and a project source from
 * the physical host. This package neither reads environment state nor imports
 * the legacy application graph.
 */
export class WorkerStoredObjectStorageRuntimeFactory {
  static create(options: {
    config: WorkerStoredObjectStorageConfig;
    projects: WorkerProjectS3SourcePort;
  }): WorkerStoredObjectStorageRuntimeFactory {
    if (options.config.backend === "azure" && !options.config.azure) {
      throw new Error("Worker Azure storage requires a configured Azure driver factory");
    }
    return new WorkerStoredObjectStorageRuntimeFactory(options.config, options.projects);
  }

  private constructor(
    private readonly config: WorkerStoredObjectStorageConfig,
    private readonly projects: WorkerProjectS3SourcePort,
  ) {}

  createRuntime(): StoredObjectStorageRuntime {
    const selection: StoredObjectStorageSelection = {
      backend: this.config.backend,
      globalS3Bucket: this.config.globalS3?.bucket,
      localFilesystemRoot: this.config.localFilesystemRoot,
      ...(this.config.azure ? { azure: this.config.azure } : {}),
    };

    return StoredObjectStorageRuntime.create({
      destination: StoredObjectDestinationPolicy.create({
        selection,
        projects: this.projects,
      }),
      s3ForProject: (projectId, aws) =>
        WorkerS3StorageDriver.create({
          projectId,
          aws,
          projects: this.projects,
          global: this.config.globalS3,
        }),
      fileForProject: () => WorkerLocalFilesystemStorageDriver.create(),
      ...(this.config.azure ? { azureForProject: () => this.config.azure?.createDriver() } : {}),
    });
  }
}

class WorkerS3StorageDriver implements StoredObjectStorageDriver {
  static create(options: {
    projectId: string;
    aws: AwsClientProcessRuntime;
    projects: WorkerProjectS3SourcePort;
    global: WorkerProjectS3Target | undefined;
  }): WorkerS3StorageDriver {
    return new WorkerS3StorageDriver(
      options.projectId,
      options.aws,
      options.projects,
      options.global,
    );
  }

  private constructor(
    private readonly projectId: string,
    private readonly aws: AwsClientProcessRuntime,
    private readonly projects: WorkerProjectS3SourcePort,
    private readonly global: WorkerProjectS3Target | undefined,
  ) {}

  async get(uri: string): Promise<Readable> {
    const { bucket, key } = parseS3Uri(uri);
    try {
      const response = await (
        await this.client()
      ).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return response.Body as Readable;
    } catch (error: unknown) {
      if (isNotFound(error)) throw new WorkerStoredObjectNotFoundError(uri);
      throw error;
    }
  }

  async put(uri: string, bytes: Buffer, mediaType: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    await (
      await this.client()
    ).send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mediaType }));
  }

  async delete(uri: string): Promise<void> {
    const { bucket, key } = parseS3Uri(uri);
    await (await this.client()).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async exists(uri: string): Promise<boolean> {
    const { bucket, key } = parseS3Uri(uri);
    try {
      await (await this.client()).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  private async client(): Promise<S3Client> {
    const target = (await this.projects.tryGet(this.projectId)) ?? this.global;
    const endpoint = target?.endpoint;
    const region = target?.region;
    return new S3Client({
      ...this.aws.build({
        region,
        targetHost: endpoint ?? defaultS3Host(region),
        endpoint,
        staticCredentials: target?.credentials,
      }),
      forcePathStyle: true,
    });
  }
}

class WorkerLocalFilesystemStorageDriver implements StoredObjectStorageDriver {
  static create(): WorkerLocalFilesystemStorageDriver {
    return new WorkerLocalFilesystemStorageDriver();
  }

  async get(uri: string): Promise<Readable> {
    const stream = createReadStream(parseFileUri(uri));
    return new Promise<Readable>((resolve, reject) => {
      stream.once("error", (error: NodeJS.ErrnoException) => {
        reject(error.code === "ENOENT" ? new WorkerStoredObjectNotFoundError(uri) : error);
      });
      stream.once("open", () => resolve(stream));
    });
  }

  async put(uri: string, bytes: Buffer, _mediaType: string): Promise<void> {
    const finalPath = parseFileUri(uri);
    const temporaryPath = `${finalPath}.tmp.${crypto.randomBytes(6).toString("hex")}`;
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    try {
      await fs.writeFile(temporaryPath, bytes);
      await fs.rename(temporaryPath, finalPath);
    } catch (error: unknown) {
      await fs.rm(temporaryPath, { force: true }).catch(() => void 0);
      throw error;
    }
  }

  async delete(uri: string): Promise<void> {
    await fs.rm(parseFileUri(uri), { force: true });
  }

  async exists(uri: string): Promise<boolean> {
    try {
      await fs.access(parseFileUri(uri));
      return true;
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) return false;
      throw error;
    }
  }
}

class WorkerStoredObjectNotFoundError extends Error {
  constructor(uri: string) {
    super(`Stored object not found: ${uri}`);
    this.name = "ObjectNotFoundError";
  }
}

function parseS3Uri(uri: string): { bucket: string; key: string } {
  if (getStoredObjectStorageScheme(uri) !== "s3") {
    throw new Error(`Worker S3 storage received a non-S3 URI: "${uri}"`);
  }
  const separator = uri.indexOf("/", "s3://".length);
  const bucket = separator === -1 ? "" : uri.slice("s3://".length, separator);
  const key = separator === -1 ? "" : uri.slice(separator + 1);
  if (!bucket || !key) throw new Error(`Invalid S3 URI: "${uri}"`);
  return { bucket, key };
}

function parseFileUri(uri: string): string {
  if (getStoredObjectStorageScheme(uri) !== "file") {
    throw new Error(`Worker filesystem storage received a non-file URI: "${uri}"`);
  }
  const decoded = decodeURIComponent(new URL(uri).pathname);
  if (decoded.split("/").includes("..")) {
    throw new Error("Worker filesystem storage refuses a path containing a '..' segment");
  }
  return path.resolve(decoded);
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : undefined;
  const metadata =
    "$metadata" in error && typeof error.$metadata === "object" ? error.$metadata : undefined;
  const statusCode =
    metadata && metadata !== null && "httpStatusCode" in metadata
      ? metadata.httpStatusCode
      : undefined;
  return name === "NoSuchKey" || name === "NotFound" || statusCode === 404;
}

function defaultS3Host(region: string | undefined): string {
  if (!region || region === "auto") return "s3.amazonaws.com";
  return `s3.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`;
}
