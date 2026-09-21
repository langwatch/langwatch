import type { BrowserSessionApi } from "@langwatch/auth-contract";
import type { AdminOperationInput } from "@langwatch/ops-contract";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { TestUserApi } from "../../services/__tests__/support/test-user-api.ts";
import { AdminBackofficeService } from "../../services/admin-backoffice.service.ts";
import { AdminAuditSink } from "../../services/impersonation.service.ts";
import { AdminBackofficeRepository } from "../admin/admin-backoffice.repository.ts";

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

/** The one operation an operator's email edit reaches on the directory. */
const updateProfileFake = (email = user.email) =>
  vi.fn(async (): Promise<UserProfile> => ({ ...user, email }));

class AuthFake implements BrowserSessionApi {
  async listBrowserSessions(): Promise<never[]> {
    return [];
  }
  async endBrowserSession(): Promise<{ ended: number }> {
    return { ended: 0 };
  }
  async isWithinBudget(): Promise<boolean> {
    return false;
  }
  async route(): Promise<never> {
    throw new Error("not configured");
  }
  async addressIsRegistered(): Promise<boolean> {
    return false;
  }
  async requestSignUpVerification(): Promise<void> {}
  async completeSignUpVerification(): Promise<never> {
    throw new Error("not configured");
  }
  async readInviteLanding(): Promise<never> {
    throw new Error("not configured");
  }
  async requestFreshInvite(): Promise<void> {}
  async resolveAuthProvider(): Promise<string> {
    return "email";
  }
  tryVerifyBrowserSession = vi.fn(async () => null);
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
  /** @scenario "An operator changing a user's email revokes their browser sessions" */
  it("persists an email before revoking browser sessions", async () => {
    const order: string[] = [];
    const updateProfile = vi.fn(async (): Promise<UserProfile> => {
      order.push("profile");
      return { ...user, email: "new@example.com" };
    });
    const users = new TestUserApi({ updateProfile, findById: async () => user });
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

    expect(updateProfile).toHaveBeenCalledWith({ id: user.id, email: "new@example.com" });
    expect(auth.revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: user.id });
    expect(order).toEqual(["profile", "sessions"]);
  });

  /** @scenario "A change that only differs in case or spacing revokes nothing" */
  it("does not revoke sessions for a normalized case-only change", async () => {
    const updateProfile = updateProfileFake();
    const users = new TestUserApi({ updateProfile, findById: async () => user });
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

  /** @scenario "A failed revocation still leaves the new backoffice email in place" */
  it("retains the profile update when browser-session revocation fails", async () => {
    const updateProfile = updateProfileFake("new@example.com");
    const users = new TestUserApi({ updateProfile, findById: async () => user });
    const auth = new AuthFake();
    auth.revokeAllBrowserSessions.mockRejectedValue(new Error("redis unavailable"));
    const service = AdminBackofficeService.create({
      repository: new RepositoryFake(),
      users,
      auth,
      audit: new AuditFake(),
    });

    await expect(service.execute(input("new@example.com"))).rejects.toThrow("redis unavailable");

    expect(updateProfile).toHaveBeenCalledWith({ id: user.id, email: "new@example.com" });
  });
});
