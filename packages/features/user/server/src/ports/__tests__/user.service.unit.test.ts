import type { OrganizationService } from "@langwatch/organization-contract";
import { USER_AVATAR_MAX_BYTES, type UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { UserAvatarStoragePort } from "../user.port";
import { UserRepository } from "../../repositories/user.repository";
import { UserService } from "../../services/user.service";

const user: UserFullProfile = {
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: null,
  lastHomePath: null,
  tracesExplorerTourDismissedAt: null,
};

class StubRepository extends UserRepository {
  getProfiles = vi.fn(async () => [user]);
  tryFindById = vi.fn(async () => user);
  tryFindByEmail = vi.fn(async () => user);
  create = vi.fn(async () => user);
  updateProfile = vi.fn(async () => user);
  tryGetAccountInfo = vi.fn(async () => ({ createdAt: user.createdAt }));
  createCredentialUser = vi.fn(async () => ({ id: user.id }));
  createPasskeyUser = vi.fn(async () => ({ id: user.id }));
  hasPassword = vi.fn(async () => true);
  setFirstPassword = vi.fn(async () => "set" as const);
  getPasskeyNudgeStatus = vi.fn(async () => ({ hasPasskey: false, dismissedAt: null }));
  setPasskeyNudgeDismissedAt = vi.fn(async () => undefined);
  getSsoStatus = vi.fn(async () => ({ pendingSsoSetup: false }));
  getTraceExplorerTourPreference = vi.fn(async () => ({
    dismissed: false,
    dismissedAt: null,
  }));
  setTraceExplorerTourDismissedAt = vi.fn(async (_id, dismissedAt) => ({
    dismissed: true,
    dismissedAt,
  }));
  setLastLoginAt = vi.fn(async () => undefined);
  tryGetLastHomePath = vi.fn(async () => null);
  setLastHomePath = vi.fn(async () => undefined);
  setDeactivatedAt = vi.fn(async () => user);
  setAvatar = vi.fn(async (_id: string, _image: string | null): Promise<void> => undefined);
}

class StubAvatarStorage extends UserAvatarStoragePort {
  store = vi.fn(async () => ({ id: "object-1" }));
}

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function createService() {
  const repository = new StubRepository();
  const avatarStorage = new StubAvatarStorage();
  const organizations = {
    ensurePersonalWorkspace: vi.fn(async () => ({
      project: { id: "project-1" },
    })),
  } as unknown as OrganizationService;
  return {
    service: UserService.create({
      repository,
      organizations,
      avatarStorage,
      now: () => new Date(42),
    }),
    repository,
    avatarStorage,
  };
}

describe("UserService", () => {
  it("loads requested profiles through one batched repository read", async () => {
    const { service, repository } = createService();

    await expect(service.getProfiles({ userIds: ["user-1", "user-1", "user-2"] })).resolves.toEqual(
      [user],
    );
    expect(repository.getProfiles).toHaveBeenCalledWith(["user-1", "user-2"]);
  });

  it("creates a profile through its private repository", async () => {
    const { service, repository } = createService();

    await service.create({ name: "Grace", email: "grace@example.com" });

    expect(repository.create).toHaveBeenCalledWith({
      name: "Grace",
      email: "grace@example.com",
    });
  });

  it("creates credential and passkey accounts through its private repository", async () => {
    const { service, repository } = createService();

    await service.createCredentialUser({
      name: "Grace",
      email: "grace@example.com",
      passwordHash: "hash",
    });
    await service.createPasskeyUser({ email: "passkey@example.com" });

    expect(repository.createCredentialUser).toHaveBeenCalledWith({
      name: "Grace",
      email: "grace@example.com",
      passwordHash: "hash",
    });
    expect(repository.createPasskeyUser).toHaveBeenCalledWith({
      email: "passkey@example.com",
    });
  });

  it("checks whether a credential password exists through its private repository", async () => {
    const { service, repository } = createService();

    await expect(service.hasPassword({ id: "user-1" })).resolves.toBe(true);
    expect(repository.hasPassword).toHaveBeenCalledWith("user-1");
  });

  it("sets a first password through its private repository", async () => {
    const { service, repository } = createService();

    await expect(
      service.setFirstPassword({ id: "user-1", passwordHash: "bcrypt-hash" }),
    ).resolves.toBe("set");
    expect(repository.setFirstPassword).toHaveBeenCalledWith({
      id: "user-1",
      passwordHash: "bcrypt-hash",
    });
  });

  it("owns passkey-nudge state through its private repository", async () => {
    const { service, repository } = createService();

    await expect(service.getPasskeyNudgeStatus({ id: "user-1" })).resolves.toEqual({
      hasPasskey: false,
      dismissedAt: null,
    });
    await service.dismissPasskeyNudge({ id: "user-1" });

    expect(repository.getPasskeyNudgeStatus).toHaveBeenCalledWith("user-1");
    expect(repository.setPasskeyNudgeDismissedAt).toHaveBeenCalledWith("user-1", new Date(42));
  });

  /** @scenario "Deactivating a user invalidates every session family" */
  it("marks a user deactivated", async () => {
    const { service, repository } = createService();
    await service.deactivate({ id: "user-1" });
    expect(repository.setDeactivatedAt).toHaveBeenCalledWith("user-1", new Date(42));
  });

  it("normalizes a changed email", async () => {
    const { service, repository } = createService();
    await service.updateProfile({ id: "user-1", email: "NEW@Example.com " });
    expect(repository.updateProfile).toHaveBeenCalledWith({
      id: "user-1",
      email: "new@example.com",
    });
  });

  it("updates a name without changing email", async () => {
    const { service, repository } = createService();

    await service.updateProfile({ id: "user-1", name: "Ada Lovelace" });

    expect(repository.updateProfile).toHaveBeenCalledWith({
      id: "user-1",
      name: "Ada Lovelace",
    });
  });

  it("normalizes an email case-only update", async () => {
    const { service, repository } = createService();

    await service.updateProfile({ id: "user-1", email: "ADA@EXAMPLE.COM" });

    expect(repository.updateProfile).toHaveBeenCalledWith({
      id: "user-1",
      email: "ada@example.com",
    });
  });

  it("rejects a blank normalized email before writing", async () => {
    const { service, repository } = createService();

    await expect(service.updateProfile({ id: "user-1", email: "   " })).rejects.toThrow();

    expect(repository.updateProfile).not.toHaveBeenCalled();
  });

  /** @scenario "Uploading a photo stores it and sets it as the user's avatar" */
  /** @scenario "Uploading an avatar uses the personal workspace" */
  it("stores avatars through the injected storage capability", async () => {
    const { service, repository, avatarStorage } = createService();
    await expect(
      service.setAvatar({
        userId: "user-1",
        organizationId: "org-1",
        imageDataUrl: PNG,
      }),
    ).resolves.toEqual({ image: "/api/user-avatar/project-1/object-1" });
    expect(avatarStorage.store).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", userId: "user-1" }),
    );
    expect(repository.setAvatar).toHaveBeenCalledWith(
      "user-1",
      "/api/user-avatar/project-1/object-1",
    );
  });

  it("owns user-scoped display preferences", async () => {
    const { service, repository } = createService();
    await service.dismissTraceExplorerTour({ id: "user-1" });
    await service.updateLastLogin({ id: "user-1" });
    await service.setLastHomePath({ id: "user-1", path: "/me/usage" });
    expect(repository.setTraceExplorerTourDismissedAt).toHaveBeenCalledWith("user-1", new Date(42));
    expect(repository.setLastLoginAt).toHaveBeenCalledWith("user-1", new Date(42));
    expect(repository.setLastHomePath).toHaveBeenCalledWith("user-1", "/me/usage");
  });
});

/**
 * The one column an avatar lives in, and the four things that decide what it
 * holds.
 *
 * `User.image` is written by exactly two callers — the upload and the removal —
 * plus the identity provider at account creation. There is no precedence rule
 * to implement and none to test: the column has a single value and the last
 * writer owns it. What these pin is that the writers are the ones we think they
 * are, and that the sign-in path is not one of them.
 *
 * Spec: specs/settings/user-avatar-upload.feature
 */
describe("given a user whose photo came from their identity provider", () => {
  const SSO_PHOTO = "https://cdn.identity.test/photos/ada.png";

  function createStatefulService() {
    class StatefulRepository extends StubRepository {
      image: string | null = SSO_PHOTO;
      override setAvatar = vi.fn<(id: string, image: string | null) => Promise<void>>(
        async (_id, image) => {
          this.image = image;
        },
      );
      override tryFindById = vi.fn<() => Promise<UserFullProfile>>(async () => ({
        ...user,
        image: this.image,
      }));
    }
    const repository = new StatefulRepository();
    const organizations = {
      ensurePersonalWorkspace: vi.fn<() => Promise<{ project: { id: string } }>>(async () => ({
        project: { id: "project-1" },
      })),
    } as unknown as OrganizationService;
    return {
      service: UserService.create({
        repository,
        organizations,
        avatarStorage: new StubAvatarStorage(),
        now: () => new Date(42),
      }),
      repository,
    };
  }

  describe("when they upload their own photo", () => {
    /** @scenario "An uploaded photo wins over the SSO provider photo" */
    it("resolves their avatar to the uploaded photo rather than the provider's", async () => {
      const { service } = createStatefulService();

      await service.setAvatar({
        userId: "user-1",
        organizationId: "org-1",
        imageDataUrl: PNG,
      });

      await expect(service.tryFindById({ id: "user-1" })).resolves.toMatchObject({
        image: "/api/user-avatar/project-1/object-1",
      });
    });
  });

  describe("when they sign in again through that provider", () => {
    /** @scenario "Signing in again through SSO does not overwrite an uploaded photo" */
    it("records the sign-in without touching the photo they uploaded", async () => {
      const { service, repository } = createStatefulService();
      await service.setAvatar({
        userId: "user-1",
        organizationId: "org-1",
        imageDataUrl: PNG,
      });
      repository.setAvatar.mockClear();

      // What a fresh sign-in writes through this service, and all it writes.
      await service.updateLastLogin({ id: "user-1" });

      expect(repository.setLastLoginAt).toHaveBeenCalledWith("user-1", new Date(42));
      expect(repository.setAvatar).not.toHaveBeenCalled();
      await expect(service.tryFindById({ id: "user-1" })).resolves.toMatchObject({
        image: "/api/user-avatar/project-1/object-1",
      });
    });
  });

  describe("when they remove the photo they uploaded", () => {
    /** @scenario "Removing the photo reverts to the fallback avatar" */
    it("clears the column so the initials fallback applies again", async () => {
      const { service, repository } = createStatefulService();
      await service.setAvatar({
        userId: "user-1",
        organizationId: "org-1",
        imageDataUrl: PNG,
      });

      await service.removeAvatar({ userId: "user-1" });

      expect(repository.setAvatar).toHaveBeenLastCalledWith("user-1", null);
      // Null, not the provider's photo: removal returns the person to the
      // fallback chain rather than resurrecting an SSO picture they replaced.
      await expect(service.tryFindById({ id: "user-1" })).resolves.toMatchObject({ image: null });
    });
  });
});

/**
 * A refused upload has to leave the account exactly as it was.
 *
 * The codec's own suite pins WHICH payloads are refused; what these pin is the
 * consequence — that a refusal happens before anything is written, so a
 * customer who picks the wrong file still has the photo they had. The order is
 * load-bearing: validation runs before the personal workspace is ensured and
 * before the store is reached.
 *
 * Spec: specs/settings/user-avatar-upload.feature
 */
describe("given a signed-in user on their profile settings", () => {
  const OVERSIZED = `data:image/png;base64,${Buffer.alloc(USER_AVATAR_MAX_BYTES + 1).toString("base64")}`;
  const NOT_AN_IMAGE = "data:application/pdf;base64,JVBERi0xLjQK";

  describe("when they upload an image over the maximum size", () => {
    /** @scenario "An oversized image is rejected" */
    it("refuses by code and leaves the stored avatar untouched", async () => {
      const { service, repository, avatarStorage } = createService();

      await expect(
        service.setAvatar({ userId: "user-1", organizationId: "org-1", imageDataUrl: OVERSIZED }),
      ).rejects.toMatchObject({ code: "avatar_image_too_large" });

      expect(avatarStorage.store).not.toHaveBeenCalled();
      expect(repository.setAvatar).not.toHaveBeenCalled();
    });
  });

  describe("when they upload a file that is not an allowed image type", () => {
    /** @scenario "A non-image file is rejected" */
    it("refuses by code and leaves the stored avatar untouched", async () => {
      const { service, repository, avatarStorage } = createService();

      await expect(
        service.setAvatar({
          userId: "user-1",
          organizationId: "org-1",
          imageDataUrl: NOT_AN_IMAGE,
        }),
      ).rejects.toMatchObject({ code: "avatar_image_type_unsupported" });

      expect(avatarStorage.store).not.toHaveBeenCalled();
      expect(repository.setAvatar).not.toHaveBeenCalled();
    });
  });
});
