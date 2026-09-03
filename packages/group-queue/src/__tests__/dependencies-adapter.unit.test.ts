import IORedis from "ioredis";
import { describe, expect, it } from "vitest";
import { GroupQueueDependenciesAdapter, type GroupQueueStoragePort } from "../dependencies-adapter";

function storage(): GroupQueueStoragePort {
  return {
    objectStoreFor: () => ({
      put: async () => undefined,
      get: async () => {
        throw new Error("not implemented");
      },
      delete: async () => undefined,
    }),
    resolveDestination: async () => ({ kind: "file", root: "/tmp/langwatch" }),
  };
}

describe("GroupQueueDependenciesAdapter", () => {
  it("projects injected policy and storage without taking ownership", async () => {
    const redis = new IORedis({ lazyConnect: true });
    const adapter = GroupQueueDependenciesAdapter.create({
      redis,
      policy: { compression: "zstd", payloadCodec: "msgpack" },
      storage: storage(),
    });

    const dependencies = adapter.dependencies();
    expect(dependencies).toMatchObject({
      policy: { compression: "zstd", payloadCodec: "msgpack" },
      redis,
    });
    expect(dependencies.objectStoreFor?.("project-1")).toBeDefined();
    await expect(dependencies.resolveStorageDestination?.("project-1")).resolves.toEqual({
      kind: "file",
      root: "/tmp/langwatch",
    });

    // A borrowed connection is not closed by this projection adapter.
    expect(redis.status).toBe("wait");
    redis.disconnect();
  });
});
