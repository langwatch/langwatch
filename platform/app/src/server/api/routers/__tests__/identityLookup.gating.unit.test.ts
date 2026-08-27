/**
 * @vitest-environment node
 *
 * The operator identity lookup: who reaches it, and the fact that the READ
 * is itself a recorded act.
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { identityLookupRouter } from "../identityLookup";

const { mockService, mockAuditLog, mockRuntime } = vi.hoisted(() => ({
  mockService: {
    resolve: vi.fn(),
    person: vi.fn(),
    recentActivity: vi.fn(),
    claimQueue: vi.fn(),
    confirmProposedSignIn: vi.fn(),
    rejectProposedSignIn: vi.fn(),
    detachMethod: vi.fn(),
    endSessions: vi.fn(),
    resendInvitation: vi.fn(),
    extendInvitation: vi.fn(),
  },
  mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
  mockRuntime: vi.fn(),
}));

/**
 * The service is real code under test in its own suite; here it is a spy, so
 * these tests can say WHICH verb a procedure reached, and — the point of
 * this file — whether the record was written before the gate.
 */
vi.mock("~/server/app-layer/identity/identity-lookup-runtime", () => ({
  identityLookup: mockRuntime,
}));

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: mockAuditLog }));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  const passthrough = async ({ ctx, next }: any) => {
    ctx.permissionChecked = true;
    return next();
  };
  return {
    ...actual,
    skipPermissionCheck: (arg?: any) =>
      arg && typeof arg.next === "function" ? passthrough(arg) : passthrough,
  };
});

function buildCaller(email: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: userIdFor(email), email }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  return identityLookupRouter.createCaller(ctx);
}

function userIdFor(email: string): string {
  return email === "olive@langwatch.ai" ? "user_olive" : "user_mallory";
}

const NOBODY = {
  typed: "nobody@acme.com",
  resolved: "nobody@acme.com",
  domain: "acme.com",
  routing: {
    outcome: "method_picker",
    reasonCode: "no_domain_match",
    connectionId: null,
    methods: ["password"],
    connection: null,
  },
  people: [],
};

describe("the operator identity lookup", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "olive@langwatch.ai";
    mockRuntime.mockReturnValue(mockService);
    mockAuditLog.mockResolvedValue(undefined);
    mockService.resolve.mockResolvedValue(NOBODY);
    mockService.recentActivity.mockResolvedValue([]);
    mockService.resendInvitation.mockResolvedValue({
      expiresAtMs: 1_700_000_000_000,
    });
    mockService.extendInvitation.mockResolvedValue({
      expiresAtMs: 1_700_000_000_000,
    });
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  describe("given an operator with platform operator access", () => {
    describe("when she resolves an address", () => {
      /** @scenario "Resolving an address across organizations is recorded as an act" */
      it("records who resolved which address and when, before it answers", async () => {
        await buildCaller("olive@langwatch.ai").resolve({
          address: "sam@acme.com",
        });

        expect(mockAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_olive",
            action: "identityLookup.resolve",
            args: { address: "sam@acme.com" },
            targetKind: "identityLookup",
          }),
        );
        // Written whether or not she then changes anything: this call
        // changed nothing at all, and the row is still there.
        expect(mockService.resolve).toHaveBeenCalledOnce();
      });

      /** @scenario "The recorded address is the address, and the history is not a copy of the person" */
      it("puts the resolved address and the operator on the record, and nothing secret", async () => {
        await buildCaller("olive@langwatch.ai").resolve({
          address: "SAM@acme.com",
        });

        const recorded = mockAuditLog.mock.calls[0]?.[0] as {
          userId: string;
          args: Record<string, unknown>;
        };
        expect(recorded.userId).toBe("user_olive");
        // The address as the auth screens folds it, so the trail is searchable
        // by the same value routing decided on.
        expect(recorded.args).toEqual({ address: "sam@acme.com" });
        // The whole argument bag, so a later field cannot slip in unnoticed.
        expect(Object.keys(recorded.args)).toEqual(["address"]);
      });
    });

    describe("when the address is one nobody holds", () => {
      /** @scenario "A lookup that finds nobody is recorded exactly like one that finds somebody" */
      it("answers that nobody holds it and records the same act", async () => {
        const answer = await buildCaller("olive@langwatch.ai").resolve({
          address: "nobody@acme.com",
        });

        expect(answer.people).toEqual([]);
        expect(mockAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_olive",
            action: "identityLookup.resolve",
            args: { address: "nobody@acme.com" },
          }),
        );
      });
    });

    describe("when she opens what operators have done recently", () => {
      /** @scenario "Who looked somebody up is readable by an operator, on this surface" */
      it("reads it back off the same trail the repairs write to", async () => {
        mockService.recentActivity.mockResolvedValue([
          {
            auditId: "aud_1",
            operatorUserId: "user_ash",
            operatorName: "Ash",
            act: "resolve",
            address: "sam@acme.com",
            atMs: 1_700_000_000_000,
          },
        ]);

        const activity = await buildCaller("olive@langwatch.ai").recentActivity(
          {},
        );

        expect(activity).toEqual([
          expect.objectContaining({
            operatorName: "Ash",
            act: "resolve",
            address: "sam@acme.com",
          }),
        ]);
      });

      it("records the reads and the repairs under one action prefix", async () => {
        const caller = buildCaller("olive@langwatch.ai");
        await caller.resolve({ address: "sam@acme.com" });
        await caller.detachMethod({
          userId: "user_sam",
          identifierId: "idf_1",
        });

        const actions = mockAuditLog.mock.calls
          .map((call) => (call[0] as { action: string }).action)
          .filter((action) => action.startsWith("identityLookup."));
        expect(actions).toEqual([
          "identityLookup.resolve",
          "identityLookup.detachMethod",
        ]);
      });
    });

    describe("when she resends an invitation", () => {
      /** @scenario "Resending an invitation from here does what resending does anywhere" */
      it("runs the ordinary resend and records it against her", async () => {
        await buildCaller("olive@langwatch.ai").resendInvitation({
          organizationId: "org_acme",
          inviteId: "inv_1",
        });

        // The same verb the organization's own admins reach, so a fresh
        // invitation goes out and the previous code stops working.
        expect(mockService.resendInvitation).toHaveBeenCalledWith({
          organizationId: "org_acme",
          inviteId: "inv_1",
        });
        expect(mockAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_olive",
            action: "identityLookup.resendInvitation",
            targetId: "inv_1",
          }),
        );
      });
    });

    describe("when she extends an invitation", () => {
      /** @scenario "Extending an invitation moves its expiry and says by how much" */
      it("answers with the new expiry as a moment in time and records the extension", async () => {
        const answer = await buildCaller("olive@langwatch.ai").extendInvitation(
          { organizationId: "org_acme", inviteId: "inv_1" },
        );

        // An absolute expiry, not a duration the reader has to add up.
        expect(answer.expiresAtMs).toBe(1_700_000_000_000);
        expect(mockAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_olive",
            action: "identityLookup.extendInvitation",
            targetId: "inv_1",
          }),
        );
      });
    });
  });

  describe("given somebody outside the staff list", () => {
    describe("when they request the lookup", () => {
      /** @scenario "A refused lookup is recorded as an attempt, and reveals nothing" */
      it("refuses, answers nothing about the address, and keeps the attempt", async () => {
        await expect(
          buildCaller("mallory@acme.com").resolve({ address: "sam@acme.com" }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        // Nothing was resolved...
        expect(mockService.resolve).not.toHaveBeenCalled();
        // ...and the attempt is on the record with who made it.
        expect(mockAuditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_mallory",
            action: "identityLookup.resolve",
            args: { address: "sam@acme.com" },
          }),
        );
      });

      /** @scenario "Without platform operator access the surface is not there at all" */
      it("answers exactly what an address this installation does not serve answers", async () => {
        const refused = await buildCaller("mallory@acme.com")
          .resolve({ address: "sam@acme.com" })
          .catch((error: unknown) => error);

        // NOT_FOUND, not FORBIDDEN, and the generic code rather than one
        // naming the surface: the answer must not confirm the surface exists.
        expect(refused).toMatchObject({ code: "NOT_FOUND" });
        const handled = (refused as { cause?: { code?: string } }).cause;
        expect(handled?.code).toBe("not_found");
        expect(JSON.stringify(refused)).not.toContain("identityLookup");
      });
    });
  });
});
