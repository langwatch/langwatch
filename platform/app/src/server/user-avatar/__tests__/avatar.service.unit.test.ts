import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { AvatarValidationError } from "../avatar";
import { UserAvatarService } from "../avatar.service";

const PNG_1x1_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makeService({
  storeId = "so_generated",
  projectId = "proj_personal",
}: {
  storeId?: string;
  projectId?: string;
} = {}) {
  const userUpdate = vi.fn().mockResolvedValue({});
  const prisma = { user: { update: userUpdate } } as unknown as PrismaClient;
  const ensureWorkspaceProject = vi.fn().mockResolvedValue({ projectId });
  const storeAvatarBytes = vi.fn().mockResolvedValue({ id: storeId });
  const service = new UserAvatarService(prisma, {
    ensureWorkspaceProject,
    storeAvatarBytes,
  });
  return { service, userUpdate, ensureWorkspaceProject, storeAvatarBytes };
}

describe("UserAvatarService", () => {
  describe("setAvatar", () => {
    describe("given a valid image and organization", () => {
      it("stores the bytes under the user's personal project tagged as a user avatar", async () => {
        const { service, storeAvatarBytes, ensureWorkspaceProject } =
          makeService({ projectId: "proj_personal" });

        await service.setAvatar({
          userId: "user_1",
          organizationId: "org_1",
          imageDataUrl: PNG_1x1_DATA_URL,
        });

        expect(ensureWorkspaceProject).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_1",
            organizationId: "org_1",
          }),
        );
        expect(storeAvatarBytes).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj_personal",
            userId: "user_1",
            mediaType: "image/png",
          }),
        );
      });

      it("writes the serve URL to User.image and returns it", async () => {
        const { service, userUpdate } = makeService({
          projectId: "proj_personal",
          storeId: "so_abc",
        });

        const result = await service.setAvatar({
          userId: "user_1",
          organizationId: "org_1",
          imageDataUrl: PNG_1x1_DATA_URL,
        });

        expect(result.image).toBe("/api/user-avatar/proj_personal/so_abc");
        expect(userUpdate).toHaveBeenCalledWith({
          where: { id: "user_1" },
          data: { image: "/api/user-avatar/proj_personal/so_abc" },
        });
      });
    });

    describe("when the payload is not a valid image", () => {
      beforeEach(() => vi.clearAllMocks());

      /** @scenario A refused upload never reaches storage or the account record */
      it("rejects before touching storage or the database", async () => {
        const { service, storeAvatarBytes, userUpdate } = makeService();

        // `.is()` is a plain `instanceof` with the narrowing written once —
        // it holds only within a single module graph, which is exactly the
        // situation here: the service is imported directly and nothing
        // crosses a process or serialisation boundary. (Across one, the
        // questions are `HandledError.isHandled` and `code` equality; `.is`
        // would quietly miss a duplicated copy of the class.) Asking for the
        // abstract parent asserts the whole family without pinning which
        // member "not-an-image" happens to trip.
        await expect(
          service.setAvatar({
            userId: "user_1",
            organizationId: "org_1",
            imageDataUrl: "not-an-image",
          }),
          // Wrapped rather than passed bare: `.is` resolves the class off
          // `this`, so `toSatisfy(AvatarValidationError.is)` throws.
        ).rejects.toSatisfy((err) => AvatarValidationError.is(err));

        expect(storeAvatarBytes).not.toHaveBeenCalled();
        expect(userUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe("removeAvatar", () => {
    describe("given a user with an avatar", () => {
      it("clears User.image", async () => {
        const { service, userUpdate } = makeService();

        await service.removeAvatar({ userId: "user_1" });

        expect(userUpdate).toHaveBeenCalledWith({
          where: { id: "user_1" },
          data: { image: null },
        });
      });
    });
  });
});
