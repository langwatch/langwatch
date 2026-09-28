/**
 * @vitest-environment node
 * An avatar's bytes live in the stored-object store as a user-owned object in
 * the uploader's personal project, and the avatar door serves only those.
 * @see specs/settings/user-avatar.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  StoredObjectNotFoundError,
  type StoredObjectApi,
  type StoredObjectFileRead,
} from "@langwatch/stored-object-contract";
import { UserAvatarNotFoundError } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { avatarObjectStore } from "../user-composition.build.ts";
import { createUserTestApp, createUserTestInfrastructure } from "./user.fixture.ts";

/** The eight-byte PNG signature, which is all the codec checks. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;

const AVATAR_ROW = {
  id: "obj-1",
  purpose: "user_avatar",
  owner_kind: "user",
  media_type: "image/png",
  size_bytes: PNG.length,
};

async function* bytesOf(chunk: Uint8Array): AsyncIterable<Uint8Array> {
  yield chunk;
}

function appOver(storedObjects: Pick<StoredObjectApi, "storeFromBytes" | "readById">) {
  return createUserTestApp({
    members: createUserTestInfrastructure(avatarObjectStore(storedObjects)),
  });
}

describe("avatar objects over the stored-object store", () => {
  describe("when a person uploads their photo", () => {
    it("stores it as their own object in their personal project, readable by its viewers", async () => {
      const storeFromBytes = vi.fn<StoredObjectApi["storeFromBytes"]>(async () => ({
        reference: {
          projectId: "project-1",
          id: "obj-1",
          sha256: "a".repeat(64),
          byteLength: PNG.length,
          filename: "avatar",
          mediaType: "image/png",
          audience: "project:view",
        },
        isDuplicate: false,
      }));
      const app = appOver(createApiFixture<StoredObjectApi>({ storeFromBytes }));
      const person = await app.createCredentialUser({
        name: "Sam",
        email: "sam@acme.com",
        passwordHash: "hashed:first",
      });

      const result = await app.setOwnAvatar({
        userId: person.id,
        organizationId: "org-1",
        imageDataUrl: PNG_DATA_URL,
      });

      expect(storeFromBytes).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          filename: "avatar",
          mediaType: "image/png",
          audience: "project:view",
          purpose: "user_avatar",
          ownerKind: "user",
          ownerId: person.id,
        }),
      );
      expect(result.image).toBe("/api/user-avatar/project-1/obj-1");
    });
  });

  describe("when the avatar door reads an object", () => {
    it("streams a user avatar's bytes", async () => {
      const read: StoredObjectFileRead = { row: AVATAR_ROW, stream: bytesOf(PNG) };
      const app = appOver(createApiFixture<StoredObjectApi>({ readById: async () => read }));

      const avatar = await app.getAvatarBytes({ projectId: "project-1", id: "obj-1" });

      expect(avatar.metadata).toEqual({
        byteLength: PNG.length,
        mediaType: "image/png",
        purpose: "user_avatar",
        ownerKind: "user",
      });
      const body = new Uint8Array(await new Response(avatar.stream).arrayBuffer());
      expect(Buffer.from(body)).toEqual(PNG);
    });

    it("refuses an object that is not a user avatar", async () => {
      const read: StoredObjectFileRead = {
        row: { ...AVATAR_ROW, purpose: "trace_content", owner_kind: "trace" },
        stream: bytesOf(PNG),
      };
      const app = appOver(createApiFixture<StoredObjectApi>({ readById: async () => read }));

      await expect(
        app.getAvatarBytes({ projectId: "project-1", id: "obj-1" }),
      ).rejects.toBeInstanceOf(UserAvatarNotFoundError);
    });

    it("refuses an id the project holds no row for", async () => {
      const readById = async (): Promise<StoredObjectFileRead> => {
        throw new StoredObjectNotFoundError();
      };
      const app = appOver(createApiFixture<StoredObjectApi>({ readById }));

      await expect(
        app.getAvatarBytes({ projectId: "project-1", id: "obj-missing" }),
      ).rejects.toBeInstanceOf(UserAvatarNotFoundError);
    });
  });
});
