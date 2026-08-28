import { AuthService } from "@langwatch/auth-contract";
import type { AdminOperationInput } from "@langwatch/ops-contract";
import { UserService, type UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";
import { AdminBackofficeRepository } from "../src/repositories/admin-backoffice.repository";
import { AdminBackofficeService } from "../src/services/admin-backoffice.service";
import { AdminAuditSink } from "../src/services/impersonation.service";

const user: UserProfile = {
  id: "user-1",
  name: "Alice",
  email: "alice@example.com",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  lastLoginAt: null,
  deactivatedAt: null,
};

class UserFake extends UserService {
  getProfiles = vi.fn(async () => []);
  tryFindById = vi.fn(async () => user);
  tryFindByEmail = vi.fn(async () => null);
  create = vi.fn(async () => user);
  createCredentialUser = vi.fn(async () => ({ id: user.id }));
  createPasskeyUser = vi.fn(async () => ({ id: user.id }));
  hasPassword = vi.fn(async () => false);
  updateProfile = vi.fn(async () => user);
  getAccountInfo = vi.fn(async () => ({ createdAt: user.createdAt }));
  getSsoStatus = vi.fn(async () => ({ pendingSsoSetup: false }));
  getTraceExplorerTourPreference = vi.fn(async () => ({ dismissed: false, dismissedAt: null }));
  dismissTraceExplorerTour = vi.fn(async () => ({ dismissed: true, dismissedAt: new Date() }));
  updateLastLogin = vi.fn(async () => undefined);
  tryGetLastHomePath = vi.fn(async () => null);
  setLastHomePath = vi.fn(async () => undefined);
  deactivate = vi.fn(async () => user);
  reactivate = vi.fn(async () => user);
  setAvatar = vi.fn(async () => ({ image: "" }));
  removeAvatar = vi.fn(async () => undefined);
}

class AuthFake extends AuthService {
  tryResolveBrowserSession = vi.fn(async () => null);
  revokeAllBrowserSessions = vi.fn(async () => undefined);
  revokeBrowserSession = vi.fn(async () => undefined);
  revokeOtherBrowserSessions = vi.fn(async () => undefined);
}

class RepositoryFake extends AdminBackofficeRepository {
  execute = vi.fn();
  findUserById = vi.fn(async () => ({ data: user }));
  setUserDeactivatedAt = vi.fn(async () => undefined);
}

class AuditFake extends AdminAuditSink {
  record = vi.fn(async () => undefined);
}

function input(email: string): AdminOperationInput {
  return {
    resource: "user",
    method: "update",
    params: { id: user.id, data: { email } },
    actorId: "operator-1",
    req: { headers: {} },
  };
}

describe("AdminBackofficeService user email updates", () => {
  it("persists an email before revoking browser sessions", async () => {
    const order: string[] = [];
    const users = new UserFake();
    users.updateProfile.mockImplementation(async () => {
      order.push("profile");
      return { ...user, email: "new@example.com" };
    });
    const auth = new AuthFake();
    auth.revokeAllBrowserSessions.mockImplementation(async () => {
      order.push("sessions");
    });
    const service = AdminBackofficeService.create({
      repository: new RepositoryFake(),
      users,
      auth,
      audit: new AuditFake(),
    });

    await service.execute(input(" NEW@example.com "));

    expect(users.updateProfile).toHaveBeenCalledWith({ id: user.id, email: "new@example.com" });
    expect(auth.revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: user.id });
    expect(order).toEqual(["profile", "sessions"]);
  });

  it("does not revoke sessions for a normalized case-only change", async () => {
    const users = new UserFake();
    const auth = new AuthFake();
    const service = AdminBackofficeService.create({
      repository: new RepositoryFake(),
      users,
      auth,
      audit: new AuditFake(),
    });

    await service.execute(input("ALICE@EXAMPLE.COM"));

    expect(auth.revokeAllBrowserSessions).not.toHaveBeenCalled();
  });

  it("retains the profile update when browser-session revocation fails", async () => {
    const users = new UserFake();
    users.updateProfile.mockResolvedValue({ ...user, email: "new@example.com" });
    const auth = new AuthFake();
    auth.revokeAllBrowserSessions.mockRejectedValue(new Error("redis unavailable"));
    const service = AdminBackofficeService.create({
      repository: new RepositoryFake(),
      users,
      auth,
      audit: new AuditFake(),
    });

    await expect(service.execute(input("new@example.com"))).rejects.toThrow("redis unavailable");

    expect(users.updateProfile).toHaveBeenCalledWith({ id: user.id, email: "new@example.com" });
  });
});
