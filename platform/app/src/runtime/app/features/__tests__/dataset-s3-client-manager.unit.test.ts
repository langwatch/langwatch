import { once } from "node:events";
import { PassThrough } from "node:stream";
import { S3DatasetStorageAdapter } from "@langwatch/dataset-server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedS3ClientTarget } from "~/server/storage";

const { awsConfig, clients, responses, S3Client } = vi.hoisted(() => {
  const clients: Array<{
    destroy: ReturnType<typeof vi.fn>;
    options: unknown;
    send: ReturnType<typeof vi.fn>;
  }> = [];
  const responses: unknown[] = [];
  const S3Client = vi.fn(function (
    this: { destroy: ReturnType<typeof vi.fn>; options: unknown; send: ReturnType<typeof vi.fn> },
    options: unknown,
  ) {
    this.options = options;
    this.destroy = vi.fn();
    this.send = vi.fn(async () => responses.shift());
    clients.push(this);
  });
  return {
    // A real `AwsClientConfig` shape: the manager spreads whatever the
    // injected graph returns straight into the SDK client, so a handler-shaped
    // stub is what keeps that spread honest.
    awsConfig: vi.fn(() => ({
      requestHandler: {
        metadata: { handlerProtocol: "http/1.1" },
        destroy: () => {
          /* the process configuration owns the socket pool */
        },
        handle: async () => {
          throw new Error("No request is issued in this suite.");
        },
      },
    })),
    clients,
    responses,
    S3Client,
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    constructor(_options: unknown) {}
  },
  S3Client,
}));
import { AppDatasetS3ClientManager } from "../dataset-s3-client-manager";

function target({
  bucket,
  fingerprint,
}: {
  bucket: string;
  fingerprint: string;
}): ResolvedS3ClientTarget {
  return {
    s3Bucket: bucket,
    fingerprint,
    endpoint: "https://s3.example.test",
    region: "auto",
    credentials: { accessKeyId: "key", secretAccessKey: fingerprint },
  };
}

describe("AppDatasetS3ClientManager", () => {
  beforeEach(() => {
    clients.length = 0;
    responses.length = 0;
    awsConfig.mockClear();
  });

  it("reuses an unchanged target and replaces a changed bucket or credential identity", async () => {
    const resolveTarget = vi
      .fn<(projectId: string) => Promise<ResolvedS3ClientTarget>>()
      .mockResolvedValueOnce(target({ bucket: "before", fingerprint: "identity-1" }))
      .mockResolvedValueOnce(target({ bucket: "before", fingerprint: "identity-1" }))
      .mockResolvedValueOnce(target({ bucket: "after", fingerprint: "identity-2" }));
    const manager = AppDatasetS3ClientManager.create({
      resolveTarget,
      aws: { build: awsConfig },
    });

    const first = await manager.acquire("project-1");
    first.release();
    const unchanged = await manager.acquire("project-1");
    unchanged.release();
    const changed = await manager.acquire("project-1");
    changed.release();

    expect(resolveTarget).toHaveBeenCalledTimes(3);
    expect(first.s3Bucket).toBe("before");
    expect(unchanged.s3Client).toBe(first.s3Client);
    expect(changed.s3Bucket).toBe("after");
    expect(changed.s3Client).not.toBe(first.s3Client);
    expect(clients).toHaveLength(2);
    expect(clients[0]!.destroy).toHaveBeenCalledOnce();
    expect(awsConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        targetHost: "https://s3.example.test",
        staticCredentials: { accessKeyId: "key", secretAccessKey: "identity-1" },
      }),
    );
  });

  it("waits for an in-flight operation before disposing a superseded client", async () => {
    const resolveTarget = vi
      .fn<(projectId: string) => Promise<ResolvedS3ClientTarget>>()
      .mockResolvedValueOnce(target({ bucket: "before", fingerprint: "identity-1" }))
      .mockResolvedValueOnce(target({ bucket: "after", fingerprint: "identity-2" }));
    const manager = AppDatasetS3ClientManager.create({
      resolveTarget,
      aws: { build: awsConfig },
    });

    const active = await manager.acquire("project-1");
    const replacement = await manager.acquire("project-1");

    expect(clients[0]!.destroy).not.toHaveBeenCalled();
    replacement.release();
    active.release();
    expect(clients[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("destroys a superseded client once its retained staged-read stream closes", async () => {
    const resolveTarget = vi
      .fn<(projectId: string) => Promise<ResolvedS3ClientTarget>>()
      .mockResolvedValueOnce(target({ bucket: "before", fingerprint: "identity-1" }))
      .mockResolvedValueOnce(target({ bucket: "after", fingerprint: "identity-2" }));
    const manager = AppDatasetS3ClientManager.create({
      resolveTarget,
      aws: { build: awsConfig },
    });
    const storage = S3DatasetStorageAdapter.create(manager);
    const body = new PassThrough();
    responses.push({ Body: body });

    const stream = await storage.streamStaged({
      projectId: "project-1",
      key: "staging/project-1/upload_1",
    });
    const replacement = await manager.acquire("project-1");
    replacement.release();

    expect(clients[0]!.destroy).not.toHaveBeenCalled();
    const closed = once(stream, "close");
    body.destroy();
    await closed;

    expect(clients[0]!.destroy).toHaveBeenCalledOnce();
  });

  it("destroys every retained client during process shutdown", async () => {
    const resolveTarget = vi
      .fn<(projectId: string) => Promise<ResolvedS3ClientTarget>>()
      .mockResolvedValueOnce(target({ bucket: "one", fingerprint: "identity-1" }))
      .mockResolvedValueOnce(target({ bucket: "two", fingerprint: "identity-2" }));
    const manager = AppDatasetS3ClientManager.create({
      resolveTarget,
      aws: { build: awsConfig },
    });

    const one = await manager.acquire("project-1");
    one.release();
    const two = await manager.acquire("project-2");
    two.release();
    await manager.close();

    expect(clients).toHaveLength(2);
    expect(clients[0]!.destroy).toHaveBeenCalledOnce();
    expect(clients[1]!.destroy).toHaveBeenCalledOnce();
    await expect(manager.acquire("project-1")).rejects.toThrow("is closed");
  });
});
