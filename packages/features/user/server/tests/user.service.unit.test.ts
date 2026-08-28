import type { OrganizationService } from "@langwatch/organization-contract";
import type { UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { UserAvatarStoragePort } from "../src/ports/user.port";
import { UserRepository } from "../src/repositories/user.repository";
import { UserService } from "../src/services/user.service";

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
  setAvatar = vi.fn(async () => undefined);
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
