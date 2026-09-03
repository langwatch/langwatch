import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AzureDatasetStorageAdapter } from "../azure.dataset-storage.adapter";
import { S3DatasetStorageAdapter } from "../s3.dataset-storage.adapter";
import {
  DatasetAzureConfigResolver,
  DatasetS3ClientResolver,
  type DatasetAzureConfig,
  type DatasetBlobDriver,
  type DatasetS3Client,
} from "../../ports/dataset-storage.port";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(),
}));

const { s3Results } = vi.hoisted(() => ({ s3Results: [] as unknown[] }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {}
  class FakeS3Client {
    readonly send = vi.fn(async () => {
      const result = s3Results.shift();
      if (result instanceof Error) throw result;
      return result;
    });

    destroy(): void {}
  }

  return {
    DeleteObjectCommand: Command,
    GetObjectCommand: Command,
    HeadObjectCommand: Command,
    PutObjectCommand: Command,
    S3Client: FakeS3Client,
  };
});

function s3Client(): S3Client {
  return new S3Client({
    region: "us-east-1",
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
  });
}

function blobDriver(): DatasetBlobDriver {
  return {
    put: vi.fn(async () => {}),
    get: vi.fn(async () => Readable.from([])),
    head: vi.fn(async () => 0),
    exists: vi.fn(async () => false),
    delete: vi.fn(async () => {}),
  };
}

class SequencedS3Resolver extends DatasetS3ClientResolver {
  readonly releases: Array<ReturnType<typeof vi.fn>> = [];

  readonly acquire = vi.fn(async () => {
    const next = this.configurations.shift();
    if (!next) throw new Error("Test resolver was called too many times");
    const release = vi.fn();
    this.releases.push(release);
    return { ...next, release };
  });

  constructor(private readonly configurations: DatasetS3Client[]) {
    super();
  }
}

function streamS3Client(body: Readable): S3Client {
  s3Results.push({ Body: body });
  return s3Client();
}

class SequencedAzureResolver extends DatasetAzureConfigResolver {
  readonly resolve = vi.fn(async () => {
    const next = this.configurations.shift();
    if (!next) throw new Error("Test resolver was called too many times");
    return next;
  });

  constructor(private readonly configurations: DatasetAzureConfig[]) {
    super();
  }
}

describe("Dataset storage destination resolution", () => {
  beforeEach(() => {
    s3Results.length = 0;
  });

  it("resolves S3 credentials and bucket again for a later operation in the same project", async () => {
    const firstClient = s3Client();
    const secondClient = s3Client();
    const resolver = new SequencedS3Resolver([
      { s3Client: firstClient, s3Bucket: "before-migration" },
      { s3Client: secondClient, s3Bucket: "after-migration" },
    ]);
    const storage = S3DatasetStorageAdapter.create(resolver);
    vi.mocked(getSignedUrl).mockResolvedValue("https://upload.example.test");

    await storage.createPresignedUpload({ projectId: "project_1" });
    await storage.createPresignedUpload({ projectId: "project_1" });

    expect(resolver.acquire).toHaveBeenNthCalledWith(1, "project_1");
    expect(resolver.acquire).toHaveBeenNthCalledWith(2, "project_1");
    expect(getSignedUrl).toHaveBeenNthCalledWith(
      1,
      firstClient,
      expect.anything(),
      expect.anything(),
    );
    expect(getSignedUrl).toHaveBeenNthCalledWith(
      2,
      secondClient,
      expect.anything(),
      expect.anything(),
    );
    expect(resolver.releases[0]).toHaveBeenCalledOnce();
    expect(resolver.releases[1]).toHaveBeenCalledOnce();
  });

  it("releases a staged-read lease when its stream ends", async () => {
    const resolver = new SequencedS3Resolver([
      { s3Client: streamS3Client(Readable.from(["staged bytes"])), s3Bucket: "datasets" },
    ]);
    const storage = S3DatasetStorageAdapter.create(resolver);

    const stream = await storage.streamStaged({
      projectId: "project_1",
      key: "staging/project_1/upload_1",
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString()).toBe("staged bytes");
    expect(resolver.releases[0]).toHaveBeenCalledOnce();
  });

  it("releases a staged-read lease when its stream errors", async () => {
    const body = new PassThrough();
    const resolver = new SequencedS3Resolver([
      { s3Client: streamS3Client(body), s3Bucket: "datasets" },
    ]);
    const storage = S3DatasetStorageAdapter.create(resolver);
    const stream = await storage.streamStaged({
      projectId: "project_1",
      key: "staging/project_1/upload_1",
    });
    const errored = once(stream, "error");

    body.destroy(new Error("stream failed"));
    await errored;

    expect(resolver.releases[0]).toHaveBeenCalledOnce();
  });

  it("releases a staged-read lease when its stream closes early", async () => {
    const body = new PassThrough();
    const resolver = new SequencedS3Resolver([
      { s3Client: streamS3Client(body), s3Bucket: "datasets" },
    ]);
    const storage = S3DatasetStorageAdapter.create(resolver);
    const stream = await storage.streamStaged({
      projectId: "project_1",
      key: "staging/project_1/upload_1",
    });
    const closed = once(stream, "close");

    body.destroy();
    await closed;

    expect(resolver.releases[0]).toHaveBeenCalledOnce();
  });

  it("releases a staged-read lease when the request fails before a stream exists", async () => {
    s3Results.push(new Error("request failed"));
    const client = s3Client();
    const resolver = new SequencedS3Resolver([{ s3Client: client, s3Bucket: "datasets" }]);
    const storage = S3DatasetStorageAdapter.create(resolver);

    await expect(
      storage.streamStaged({
        projectId: "project_1",
        key: "staging/project_1/upload_1",
      }),
    ).rejects.toThrow("request failed");

    expect(resolver.releases[0]).toHaveBeenCalledOnce();
  });

  it("resolves Azure account and driver again for a later operation in the same project", async () => {
    const firstDriver = blobDriver();
    const secondDriver = blobDriver();
    const resolver = new SequencedAzureResolver([
      {
        driver: firstDriver,
        accountName: "before-migration",
        container: "datasets",
      },
      {
        driver: secondDriver,
        accountName: "after-migration",
        container: "datasets",
      },
    ]);
    const storage = AzureDatasetStorageAdapter.create(resolver);

    await storage.writeChunks({
      projectId: "project_1",
      datasetId: "dataset_1",
      records: [{ question: "before" }],
    });
    await storage.writeChunks({
      projectId: "project_1",
      datasetId: "dataset_1",
      records: [{ question: "after" }],
    });

    expect(resolver.resolve).toHaveBeenNthCalledWith(1, "project_1");
    expect(resolver.resolve).toHaveBeenNthCalledWith(2, "project_1");
    expect(firstDriver.put).toHaveBeenCalledWith(
      "azure-blob://before-migration/datasets/datasets/project_1/dataset_1/chunk-00000.jsonl",
      expect.anything(),
      "application/x-ndjson",
    );
    expect(secondDriver.put).toHaveBeenCalledWith(
      "azure-blob://after-migration/datasets/datasets/project_1/dataset_1/chunk-00000.jsonl",
      expect.anything(),
      "application/x-ndjson",
    );
  });
});
