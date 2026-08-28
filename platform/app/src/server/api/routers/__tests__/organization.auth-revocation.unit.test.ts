import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { organizationRouter } from "../organization";

vi.mock("../../../../env.mjs", () => ({
  env: {
    BASE_HOST: "http://localhost:3000",
    SENDGRID_API_KEY: "test-key",
  },
}));

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

describe("organization.setMemberDisabled auth revocation", () => {
  let setMemberDisabled: ReturnType<typeof vi.fn>;
  let revokeAllBrowserSessions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setMemberDisabled = vi.fn().mockResolvedValue(undefined);
    revokeAllBrowserSessions = vi.fn().mockResolvedValue(undefined);
  });

  function createCaller() {
    return organizationRouter.createCaller(
      createInnerTRPCContext({
        session: {
          user: { id: "admin-1", name: "Admin", email: "admin@example.com" },
          expires: "2099-01-01",
        },
        app: {
          organizations: { setMemberDisabled },
          auth: { revokeAllBrowserSessions },
          permissions: {
            checkScopeLineage: vi.fn().mockResolvedValue({ kind: "consistent" }),
            getDecision: vi.fn().mockResolvedValue({
              permitted: true,
              organizationRole: null,
              denialReason: null,
            }),
          },
        } as never,
      }),
    );
  }

  it("commits the membership disable before revoking browser sessions", async () => {
    setMemberDisabled.mockImplementation(async () => {
      expect(revokeAllBrowserSessions).not.toHaveBeenCalled();
    });

    await createCaller().setMemberDisabled({
      organizationId: "org-1",
      userId: "member-1",
      disabled: true,
    });

    expect(setMemberDisabled).toHaveBeenCalledWith({
      organizationId: "org-1",
      userId: "member-1",
      disabled: true,
      actingUser: { id: "admin-1", name: "Admin", email: "admin@example.com" },
    });
    expect(revokeAllBrowserSessions).toHaveBeenCalledWith({ userId: "member-1" });
    expect(setMemberDisabled.mock.invocationCallOrder[0]!).toBeLessThan(
      revokeAllBrowserSessions.mock.invocationCallOrder[0]!,
    );
  });

  it("does not revoke browser sessions when re-enabling a member", async () => {
    await createCaller().setMemberDisabled({
      organizationId: "org-1",
      userId: "member-1",
      disabled: false,
    });

    expect(revokeAllBrowserSessions).not.toHaveBeenCalled();
  });
});
