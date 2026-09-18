import { describe, expect, it, vi } from "vitest";
import { UserAccountService } from "../user-account.service.ts";

function createService() {
  const auth = {
    revokeAllBrowserSessions: vi.fn(async () => undefined),
    revokeOtherBrowserSessions: vi.fn(async () => undefined),
  };
  const organizations = {
    ensurePersonalWorkspace: vi.fn(),
    tryFindPersonalWorkspace: vi.fn(),
  };
  const ops = { isAdmin: vi.fn(() => true) };
  const service = UserAccountService.create({
    auth: auth as never,
    organizations: organizations as never,
    ops: ops as never,
  });

  return { service, auth, organizations, ops };
}

describe("UserAccountService", () => {
  it("accepts a legacy project key as its own personal caller", () => {
    const { service } = createService();

    expect(
      service.personalCallerFor({
        project: { isPersonal: true, ownerUserId: "owner" },
        callerUserId: undefined,
      }),
    ).toBe("owner");
  });

  it("rejects a user-bound key for another personal workspace", () => {
    const { service } = createService();

    expect(() =>
      service.personalCallerFor({
        project: { isPersonal: true, ownerUserId: "owner" },
        callerUserId: "other",
      }),
    ).toThrow("cannot read another user's personal workspace");
  });

  it("delegates session revocation to the complete Auth service", async () => {
    const { service, auth } = createService();

    await service.revokeOtherBrowserSessions({ userId: "user", keepSessionId: "session" });
    await service.revokeAllBrowserSessions({ userId: "user" });

    expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
      userId: "user",
      keepSessionId: "session",
    });
    expect(auth.revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: "user" });
  });
});
