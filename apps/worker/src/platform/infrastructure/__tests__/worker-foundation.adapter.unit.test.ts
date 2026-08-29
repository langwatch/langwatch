const { redis } = vi.hoisted(() => ({
  redis: {
    disconnect: vi.fn(),
  },
}));

vi.mock("@langwatch/redis-client", () => ({
  RedisConnectionService: class {
    connectResolved() {
      return redis;
    }
  },
  RedisShutdownService: class {
    static create() {
      return {
        shutdown(connection: typeof redis) {
          connection.disconnect();
        },
      };
    }
  },
}));

import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import {
  WorkerInfrastructureAdapter,
  WorkerStorageFactoryPort,
} from "../worker-foundation.adapter";
import { OutboundProxyResolverPort } from "@langwatch/aws-client";
import type { GroupQueueStoragePort } from "@langwatch/group-queue";
import type { RedisConfigResolution } from "@langwatch/redis-client";
import {
  StoredObjectDestinationPolicy,
  StoredObjectProjectS3ConfigPort,
  StoredObjectStorageRuntime,
} from "@langwatch/stored-object-server/storage";

class NoProxy extends OutboundProxyResolverPort {
  tryResolveForHost(): string | undefined {
    return undefined;
  }
}

class StorageFactory extends WorkerStorageFactoryPort {
  readonly create = vi.fn(() => ({
    storage: {
      objectStoreFor: () => ({
        put: async () => undefined,
        get: async () => {
          throw new Error("not implemented");
        },
        delete: async () => undefined,
      }),
      resolveDestination: async () => ({ kind: "file", root: "/tmp/langwatch" }),
    } satisfies GroupQueueStoragePort,
    close: async () => undefined,
  }));
}

class FailingStorageFactory extends StorageFactory {
  override readonly create = vi.fn(() => ({
    storage: {
      objectStoreFor: () => ({
        put: async () => undefined,
        get: async () => {
          throw new Error("not implemented");
        },
        delete: async () => undefined,
      }),
      resolveDestination: async () => ({ kind: "file", root: "/tmp/langwatch" }),
    } satisfies GroupQueueStoragePort,
    close: async () => {
      throw new Error("storage close failed");
    },
  }));
}

const redisConfig: RedisConfigResolution = {
  configured: true,
  mode: "standalone",
  url: "redis://localhost:6379",
  db: 0,
  tls: undefined,
  warnings: [],
};

class NoPrivateS3Config extends StoredObjectProjectS3ConfigPort {
  async tryGet(): Promise<Readonly<{ bucket: string }> | null> {
    return null;
  }
}

describe("WorkerInfrastructureAdapter", () => {
  it("constructs AWS, Redis, and the borrowed queue dependency projection", async () => {
    const resources = new ResourceScope();
    const storage = new StorageFactory();
    const adapter = WorkerInfrastructureAdapter.create({
      resources,
      redis: redisConfig,
      outboundProxy: new NoProxy(),
      storage,
      queuePolicy: { compression: "gzip", payloadCodec: "json" },
    });

    expect(storage.create).toHaveBeenCalledOnce();
    expect(adapter.queueDependencies.redis).toBe(adapter.redis);
    expect(adapter.queueDependencies.policy).toEqual({
      compression: "gzip",
      payloadCodec: "json",
    });
    expect(adapter.queueDependencies.objectStoreFor?.("project-1")).toBeDefined();

    await resources.close();
  });

  it("runs every owned close and retains the first failure", async () => {
    const resources = new ResourceScope();
    redis.disconnect.mockClear();
    const storage = new FailingStorageFactory();
    const adapter = WorkerInfrastructureAdapter.create({
      resources,
      redis: redisConfig,
      outboundProxy: new NoProxy(),
      storage,
    });
    const redisDisconnect = vi.spyOn(adapter.redis, "disconnect").mockImplementation(() => {
      throw new Error("redis close failed");
    });
    const awsClose = vi
      .spyOn(adapter.aws, "close")
      .mockRejectedValueOnce(new Error("aws close failed"));

    await expect(adapter.close()).rejects.toThrow("storage close failed");
    expect(awsClose).toHaveBeenCalledOnce();
    expect(redisDisconnect).toHaveBeenCalledOnce();
    redisDisconnect.mockRestore();
    awsClose.mockRestore();
  });

  it("adapts the canonical Stored Object runtime when no custom factory is supplied", async () => {
    const resources = new ResourceScope();
    redis.disconnect.mockClear();
    const driver = {
      put: async () => undefined,
      get: async () => {
        throw new Error("not implemented");
      },
      delete: async () => undefined,
      exists: async () => false,
    };
    let receivedAws: unknown;
    const runtime = StoredObjectStorageRuntime.create({
      destination: StoredObjectDestinationPolicy.create({
        selection: { backend: "file", localFilesystemRoot: "/tmp/langwatch" },
        projects: new NoPrivateS3Config(),
      }),
      s3ForProject: (_projectId, aws) => {
        receivedAws = aws;
        return driver;
      },
      fileForProject: () => driver,
    });
    const adapter = WorkerInfrastructureAdapter.create({
      resources,
      redis: redisConfig,
      outboundProxy: new NoProxy(),
      storageRuntime: runtime,
    });

    expect(adapter.queueDependencies.objectStoreFor?.("project-1")).toBeDefined();
    expect(receivedAws).toBe(adapter.aws);
    await resources.close();
    expect(redis.disconnect).toHaveBeenCalledOnce();
  });
});
