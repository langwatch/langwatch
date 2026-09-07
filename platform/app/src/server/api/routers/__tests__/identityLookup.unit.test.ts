/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { identityLookupRouter } from "../identityLookup";

const { mockAuditLog, mockLookup } = vi.hoisted(() => ({
  mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
  mockLookup: {
    resolve: vi.fn(),
    person: vi.fn(),
    recentActivity: vi.fn(),
  },
}));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: mockAuditLog }));
vi.mock("~/server/app-layer/identity/runtime", () => ({
  identityLookup: () => mockLookup,
}));

function callerFor({ id, email }: { id: string; email: string }) {
  return identityLookupRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id, email }, expires: "2099-01-01" },
      permissionChecked: true,
    }),
  );
}

describe("platform operator identity lookup authorization", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "olive@langwatch.ai";
    mockAuditLog.mockResolvedValue(undefined);
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
    mockLookup.recentActivity.mockResolvedValue([
      {
        action: "identityLookup.resolve",
        userId: "user_olive",
        args: { address: "sam@acme.com" },
        occurredAtMs: 1_700_000_000_000,
      },
    ]);
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
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
      expect(mockAuditLog.mock.invocationCallOrder[0]).toBeLessThan(
        mockLookup.resolve.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
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
      expect(mockAuditLog.mock.invocationCallOrder[0]).toBeLessThan(
        mockLookup.resolve.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    });

    /** @scenario "A refused lookup is recorded as an attempt, and reveals nothing" */
    it("records a non-operator attempt before refusing and reading nothing", async () => {
      const caller = callerFor({
        id: "user_mallory",
        email: "mallory@acme.com",
      });

      await expect(caller.resolve({ address: "sam@acme.com" })).rejects.toMatchObject({
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
      const denial = await callerFor({
        id: "user_mallory",
        email: "mallory@acme.com",
      })
        .resolve({ address: "sam@acme.com" })
        .then(
          () => {
            throw new Error("an unprivileged caller reached identity lookup");
          },
          (error: unknown) => error as { code: string; message: string },
        );

      expect(denial).toEqual({ code: "NOT_FOUND", message: "Not found" });
      expect(denial.message).not.toMatch(/identity|operator|admin|surface/i);
    });
  });

  describe("when recent operator activity is opened", () => {
    /** @scenario "Who looked somebody up is readable by an operator, on this surface" */
    it("returns lookup records from the same activity reader", async () => {
      const activity = await callerFor({
        id: "user_olive",
        email: "olive@langwatch.ai",
      }).recentActivity({});

      expect(activity).toEqual([
        expect.objectContaining({
          action: "identityLookup.resolve",
          userId: "user_olive",
        }),
      ]);
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
});
