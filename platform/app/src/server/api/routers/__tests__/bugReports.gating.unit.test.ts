/**
 * @vitest-environment node
 *
 * Gating tests for the bugReports tRPC procedures: the inbox is
 * cross-tenant, so access is strictly the LangWatch staff admin list
 * (ADMIN_EMAILS), never an organization role. Corresponds to
 * specs/support/agent-issue-reports.feature.
 */
import type { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { bugReportsRouter } from "../bugReports";

const { mockGetAll, mockAuditLog } = vi.hoisted(() => ({
  mockGetAll: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  mockAuditLog: vi.fn<(...args: unknown[]) => Promise<void>>(),
}));

vi.mock("~/server/app-layer/bug-reports/bug-report.service", () => ({
  getAllBugReports: mockGetAll,
  getBugReportById: vi.fn(),
}));

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: mockAuditLog,
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  const passthrough = async ({ ctx, next }: any) => {
    ctx.permissionChecked = true;
    return next();
  };
  return {
    ...actual,
    // Mirrors the real overload: usable directly as a middleware
    // (`.use(skipPermissionCheck)`) or as a factory (`.use(skipPermissionCheck())`).
    skipPermissionCheck: (arg?: any) =>
      arg && typeof arg.next === "function" ? passthrough(arg) : passthrough,
  };
});

function buildCaller(email: string) {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1", email }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  return bugReportsRouter.createCaller(ctx);
}

describe("bugReports gating", () => {
  const originalAdminEmails = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_EMAILS = "staff@langwatch.ai";
    mockGetAll.mockResolvedValue({ reports: [], total: 0 });
    mockAuditLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.ADMIN_EMAILS = originalAdminEmails;
  });

  describe("given a user outside the admin list", () => {
    /** @scenario "Non-admins cannot access bug reports" */
    it("denies the listing", async () => {
      const caller = buildCaller("customer@acme.com");
      await expect(caller.getAll({})).rejects.toMatchObject({
        code: "FORBIDDEN",
      } satisfies Partial<TRPCError>);
      expect(mockGetAll).not.toHaveBeenCalled();
      // The framework audit-logs the DENIAL itself; only the explicit
      // PII-read entry must be absent.
      expect(mockAuditLog).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "bugReports.getAll" }),
      );
    });
  });

  describe("given a staff admin", () => {
    it("serves the listing and audit-logs the read", async () => {
      const caller = buildCaller("staff@langwatch.ai");
      await expect(caller.getAll({})).resolves.toEqual({
        reports: [],
        total: 0,
      });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: "bugReports.getAll" }),
      );
    });
  });
});
