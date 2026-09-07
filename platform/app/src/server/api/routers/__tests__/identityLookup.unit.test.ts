/** @vitest-environment node */

import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { identityLookupRouter } from "../identityLookup";

const { activityRows, mockAuditLog, mockLookup } = vi.hoisted(() => ({
  activityRows: [] as Array<Record<string, unknown>>,
  mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
  mockLookup: {
    resolve: vi.fn(),
    person: vi.fn(),
    recentActivity: vi.fn(),
    resendInvitation: vi.fn(),
    extendInvitation: vi.fn(),
  },
}));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: mockAuditLog }));
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  identityLookup: () => mockLookup,
  identityStorageAdapter: () => memoryAdapter({}),
  secondaryStorage: () => ({ configured: false, connection: () => null }),
}));

function callerFor({ id, email }: { id: string; email: string }) {
  return identityLookupRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id, email }, expires: "2099-01-01" },
      permissionChecked: true,
    }),
  );
}

function anonymousCaller() {
  return identityLookupRouter.createCaller(
    createInnerTRPCContext({ session: null, permissionChecked: true }),
  );
}

describe("platform operator identity lookup authorization", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    activityRows.length = 0;
    process.env.ADMIN_EMAILS = "olive@langwatch.ai";
    mockAuditLog.mockImplementation(async (...args: unknown[]) => {
      const [entry] = args;
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        activityRows.push(entry as Record<string, unknown>);
      }
    });
    mockLookup.resolve.mockResolvedValue({
      typed: "sam@acme.com",
      resolved: "sam@acme.com",
      domain: "acme.com",
      routing: {
        outcome: "method_picker",
        reasonCode: "account_methods",
        connectionId: null,
        methods: ["password"],
        connection: null,
      },
      people: [{ userId: "user_sam", name: "Sam", organizations: [] }],
    });
    mockLookup.recentActivity.mockImplementation(async () => activityRows);
    mockLookup.resendInvitation.mockResolvedValue({
      expiresAtMs: 1_700_000_000_000,
    });
    mockLookup.extendInvitation.mockResolvedValue({
      expiresAtMs: 1_700_000_000_000,
    });
  });

  afterEach(() => {
    if (originalAdminEmails === void 0) {
      delete process.env.ADMIN_EMAILS;
    } else {
      process.env.ADMIN_EMAILS = originalAdminEmails;
    }
  });

  describe("when an address is resolved", () => {
    /** @scenario "Resolving an address across organizations is recorded as an act" */
    it("returns the answer and records the operator, address, and time", async () => {
      const answer = await callerFor({
        id: "user_olive",
        email: "olive@langwatch.ai",
      }).resolve({ address: "sam@acme.com" });

      expect(answer.people).toHaveLength(1);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "identityLookup.resolve",
          args: { address: "sam@acme.com" },
          targetKind: "identityLookup",
        }),
      );
      expect(mockLookup.resolve).toHaveBeenCalledWith({
        address: "sam@acme.com",
      });
      const auditCall = mockAuditLog.mock.invocationCallOrder[0];
      const resolveCall = mockLookup.resolve.mock.invocationCallOrder[0];
      if (typeof auditCall !== "number" || typeof resolveCall !== "number") {
        throw new Error("expected audit and lookup calls");
      }
      expect(auditCall).toBeLessThan(resolveCall);
    });

    /** @scenario "A lookup that finds nobody is recorded exactly like one that finds somebody" */
    it("records a lookup whose answer contains nobody", async () => {
      mockLookup.resolve.mockResolvedValueOnce({
        typed: "nobody@example.com",
        resolved: "nobody@example.com",
        domain: "example.com",
        routing: {
          outcome: "sign_up",
          reasonCode: "no_account",
          connectionId: null,
          methods: [],
          connection: null,
        },
        people: [],
      });

      const answer = await callerFor({
        id: "user_olive",
        email: "olive@langwatch.ai",
      }).resolve({ address: "nobody@example.com" });

      expect(answer.people).toEqual([]);
      expect(mockAuditLog).toHaveBeenCalledTimes(1);
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "identityLookup.resolve",
          args: { address: "nobody@example.com" },
        }),
      );
      const auditCall = mockAuditLog.mock.invocationCallOrder[0];
      const resolveCall = mockLookup.resolve.mock.invocationCallOrder[0];
      if (typeof auditCall !== "number" || typeof resolveCall !== "number") {
        throw new Error("expected audit and lookup calls");
      }
      expect(auditCall).toBeLessThan(resolveCall);
    });

    /** @scenario "A refused lookup is recorded as an attempt, and reveals nothing" */
    it("records a non-operator attempt before refusing and reading nothing", async () => {
      const caller = callerFor({
        id: "user_mallory",
        email: "mallory@acme.com",
      });

      await expect(
        caller.resolve({ address: "sam@acme.com" }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Not found",
      });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_mallory",
          action: "identityLookup.resolve",
          args: { address: "sam@acme.com" },
        }),
      );
      expect(mockLookup.resolve).not.toHaveBeenCalled();
    });

    /** @scenario "Without platform operator access the surface is not there at all" */
    it("answers with the same plain not-found as an absent surface", async () => {
      const attempt = callerFor({
        id: "user_mallory",
        email: "mallory@acme.com",
      }).resolve({ address: "sam@acme.com" });

      await expect(attempt).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "Not found",
      });
    });

    it("refuses an anonymous caller before the operator audit boundary", async () => {
      await expect(
        anonymousCaller().resolve({ address: "sam@acme.com" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(mockAuditLog).not.toHaveBeenCalled();
      expect(mockLookup.resolve).not.toHaveBeenCalled();
    });
  });

  describe("when recent operator activity is opened", () => {
    /** @scenario "Who looked somebody up is readable by an operator, on this surface" */
    it("returns lookup records from the same activity reader", async () => {
      await callerFor({
        id: "user_olive",
        email: "olive@langwatch.ai",
      }).resolve({ address: "sam@acme.com" });

      const activity = await callerFor({
        id: "user_olive",
        email: "olive@langwatch.ai",
      }).recentActivity({});

      expect(activity).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "identityLookup.resolve",
            userId: "user_olive",
            args: { address: "sam@acme.com" },
          }),
        ]),
      );
      expect(mockLookup.recentActivity).toHaveBeenCalledWith();
    });
  });

  describe("when the lookup is recorded", () => {
    /** @scenario "The recorded address is the address, and the history is not a copy of the person" */
    it("keeps only the address and operator, never credential-shaped values", async () => {
      await callerFor({
        id: "user_olive",
        email: "olive@langwatch.ai",
      }).resolve({ address: "sam@acme.com" });

      const entry = mockAuditLog.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(entry).toMatchObject({
        userId: "user_olive",
        args: { address: "sam@acme.com" },
      });
      expect(JSON.stringify(entry)).not.toMatch(/password|token|session/i);
    });
  });

  describe("when an invitation is repaired", () => {
    /** @scenario "Resending an invitation from here does what resending does anywhere" */
    it("records the operator before delegating resend to the invitation boundary", async () => {
      await expect(
        callerFor({
          id: "user_olive",
          email: "olive@langwatch.ai",
        }).resendInvitation({
          organizationId: "org_acme",
          inviteId: "invite_1",
        }),
      ).resolves.toEqual({ expiresAtMs: 1_700_000_000_000 });

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "identityLookup.resendInvitation",
          args: { organizationId: "org_acme", inviteId: "invite_1" },
          targetId: "invite_1",
        }),
      );
      expect(mockLookup.resendInvitation).toHaveBeenCalledWith({
        organizationId: "org_acme",
        inviteId: "invite_1",
      });
      const auditCall = mockAuditLog.mock.invocationCallOrder[0];
      const resendCall =
        mockLookup.resendInvitation.mock.invocationCallOrder[0];
      if (typeof auditCall !== "number" || typeof resendCall !== "number") {
        throw new Error("expected audit and resend calls");
      }
      expect(auditCall).toBeLessThan(resendCall);
    });

    /** @scenario "Extending an invitation moves its expiry and says by how much" */
    it("records the operator before delegating extension to the invitation boundary", async () => {
      await expect(
        callerFor({
          id: "user_olive",
          email: "olive@langwatch.ai",
        }).extendInvitation({
          organizationId: "org_acme",
          inviteId: "invite_1",
        }),
      ).resolves.toEqual({ expiresAtMs: 1_700_000_000_000 });

      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "identityLookup.extendInvitation",
          args: { organizationId: "org_acme", inviteId: "invite_1" },
          targetId: "invite_1",
        }),
      );
      expect(mockLookup.extendInvitation).toHaveBeenCalledWith({
        organizationId: "org_acme",
        inviteId: "invite_1",
      });
      const auditCall = mockAuditLog.mock.invocationCallOrder[0];
      const extendCall =
        mockLookup.extendInvitation.mock.invocationCallOrder[0];
      if (typeof auditCall !== "number" || typeof extendCall !== "number") {
        throw new Error("expected audit and extension calls");
      }
      expect(auditCall).toBeLessThan(extendCall);
    });
  });
});
