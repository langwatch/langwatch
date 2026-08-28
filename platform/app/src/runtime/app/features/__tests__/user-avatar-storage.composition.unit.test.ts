import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveDestination: vi.fn(),
  createRegistry: vi.fn(),
}));

vi.mock("~/server/stored-objects/project-storage-destination", () => ({
  resolveProjectStorageDestination: mocks.resolveDestination,
}));

vi.mock("~/server/stored-objects/stored-objects-factory", () => ({
  createStorageRegistry: mocks.createRegistry,
}));

import { AppUserAvatarStorageInfrastructureAdapter } from "../user-avatar-storage-infrastructure.adapter";
import { AppUserAvatarStoredObjectStorageAdapter } from "../user-avatar-stored-object-storage.adapter";

describe("user avatar storage process composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects one infrastructure collaborator and resolves destination and registry per operation", async () => {
    const put = vi.fn().mockResolvedValue(void 0);
    const registry = {
      put,
      get: vi.fn().mockResolvedValue(Readable.from([Buffer.from("avatar")])),
      delete: vi.fn().mockResolvedValue(void 0),
    };
    mocks.resolveDestination.mockResolvedValue({ kind: "s3", bucket: "avatars" });
    mocks.createRegistry.mockReturnValue(registry);

    const infrastructure = AppUserAvatarStorageInfrastructureAdapter.create();
    const storage = AppUserAvatarStoredObjectStorageAdapter.create(infrastructure);
    const address = await storage.write({
      projectId: "project_1",
      objectId: "object_1",
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    });
    await storage.tryRead({ projectId: "project_1", address });

    expect(address).toEqual({
      provider: "s3",
      destinationId: "avatars",
      relativeId: "project_1/object_1",
    });
    expect(mocks.resolveDestination).toHaveBeenCalledTimes(1);
    expect(mocks.resolveDestination).toHaveBeenCalledWith("project_1");
    expect(mocks.createRegistry).toHaveBeenCalledTimes(2);
    expect(mocks.createRegistry).toHaveBeenNthCalledWith(1, { projectId: "project_1" });
    expect(mocks.createRegistry).toHaveBeenNthCalledWith(2, { projectId: "project_1" });
    expect(put).toHaveBeenCalledWith(
      "s3://avatars/project_1/object_1",
      Buffer.from([1, 2, 3]),
      "image/png",
    );
  });
});
