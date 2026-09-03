/**
 * The avatar WRITE this process performs, over the content-addressed store it
 * already composed for trace media.
 *
 * The two columns asserted here are the ones `/api/user-avatar` compares
 * against before it serves a byte. A write that stamped either differently
 * would store a photo the read route then refuses — which is indistinguishable,
 * from the customer's side, from an upload that silently did nothing.
 *
 * Spec: specs/settings/user-avatar-upload.feature,
 * specs/server/api-process-auth.feature
 */
import { USER_AVATAR_MAX_BYTES } from "@langwatch/user-contract";
import { describe, expect, it, vi, type Mock } from "vitest";

import {
  ApiUserAvatarStorageAdapter,
  type ApiUserAvatarObjectWriter,
} from "../user-avatar-storage.adapter";

type AvatarObjectWrite = ApiUserAvatarObjectWriter["storeFromBytes"];

function writer(): { storeFromBytes: Mock<AvatarObjectWrite> } {
  return {
    storeFromBytes: vi.fn<AvatarObjectWrite>(async () => ({
      id: "object-1",
      mediaType: "image/png",
      isDuplicate: false,
    })),
  };
}

describe("given a process that composed the content-addressed store", () => {
  describe("when somebody uploads an avatar through it", () => {
    /** @scenario "Uploading a photo stores it and sets it as the user's avatar" */
    it("writes the bytes under the avatar purpose and owner kind, owned by the uploader", async () => {
      const store = writer();
      const storage = ApiUserAvatarStorageAdapter.create({
        storedObjects: () => store,
        processName: "langwatch-api",
      });

      await expect(
        storage.store({
          projectId: "project-1",
          userId: "user-1",
          mediaType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        }),
      ).resolves.toEqual({ id: "object-1" });

      expect(store.storeFromBytes).toHaveBeenCalledWith({
        projectId: "project-1",
        // Both halves of the gate `/api/user-avatar` applies on the way out.
        purpose: "user_avatar",
        ownerKind: "user",
        ownerId: "user-1",
        mediaType: "image/png",
        bytes: Buffer.from([1, 2, 3]),
      });
    });
  });

  describe("when the bytes are over the avatar ceiling", () => {
    /** @scenario "An oversized image is rejected" */
    it("refuses before the write, because this store's own ceiling is trace-media sized", async () => {
      const store = writer();
      const storage = ApiUserAvatarStorageAdapter.create({
        storedObjects: () => store,
        processName: "langwatch-api",
      });

      await expect(
        storage.store({
          projectId: "project-1",
          userId: "user-1",
          mediaType: "image/png",
          bytes: new Uint8Array(USER_AVATAR_MAX_BYTES + 1),
        }),
      ).rejects.toMatchObject({ code: "avatar_image_too_large" });
      expect(store.storeFromBytes).not.toHaveBeenCalled();
    });
  });

  describe("when the store is opened after the Auth graph that reads through it", () => {
    /** @scenario "Uploading a photo stores it and sets it as the user's avatar" */
    it("resolves the store at the upload, so composition order does not decide the answer", async () => {
      // The process's own half-built record: the entry the adapter reads is
      // filled in later, which is exactly the shape composition has.
      const process: { storedObjects?: ApiUserAvatarObjectWriter } = {};
      const storage = ApiUserAvatarStorageAdapter.create({
        storedObjects: () => process.storedObjects,
        processName: "langwatch-api",
      });

      // The product-infrastructure half composes here, long after this adapter
      // was handed to the user service.
      process.storedObjects = writer();

      await expect(
        storage.store({
          projectId: "project-1",
          userId: "user-1",
          mediaType: "image/webp",
          bytes: new Uint8Array([9]),
        }),
      ).resolves.toEqual({ id: "object-1" });
    });
  });
});

describe("given a process that composed no stored objects", () => {
  describe("when somebody uploads an avatar through it", () => {
    /** @scenario "An avatar upload refuses by name on a process with no stored objects" */
    it("refuses the write and names the process rather than dropping the bytes", async () => {
      const storage = ApiUserAvatarStorageAdapter.absent({ processName: "langwatch-api" });

      await expect(
        storage.store({
          projectId: "project-1",
          userId: "user-1",
          mediaType: "image/png",
          bytes: new Uint8Array([1]),
        }),
      ).rejects.toThrow(/langwatch-api composes no stored-object application/);
    });
  });
});
