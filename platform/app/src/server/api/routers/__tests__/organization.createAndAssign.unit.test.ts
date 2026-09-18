import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

/**
 * The one door an organization is created through.
 *
 * `onboarding.initializeOrganization` delegates here, so this is where the
 * refusal has to live: a guard on the onboarding mutation is one this
 * procedure walks straight past, and the procedure is reachable on its own.
 */

const { mockCreateAndAssign, mockStandingFor } = vi.hoisted(() => ({
  mockCreateAndAssign: vi.fn(),
  mockStandingFor: vi.fn(),
}));

vi.mock(
  "~/server/app-layer/authz/permission-adapters",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("~/server/app-layer/authz/permission-adapters")
      >();
    return {
      ...actual,
      skipPermissionCheck: ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
    };
  },
);

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ organizations: { createAndAssign: mockCreateAndAssign } }),
  tryGetApp: () => null,
}));

// Only the one read is replaced: the rest of this module is on better-auth's
// import graph, so a whole-module mock takes the sign-in engine with it.
vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  ssoTestArrival: () => ({ standingFor: mockStandingFor }),
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

import { organizationRouter } from "../organization";

function createCaller() {
  return organizationRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user_1", name: "Jane Doe", email: "jane@example.com" },
        expires: "1",
      },
      permissionChecked: false,
    }),
  );
}

describe("organization.createAndAssign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStandingFor.mockResolvedValue(null);
    mockCreateAndAssign.mockResolvedValue({
      organization: { id: "org_1", name: "Acme" },
      team: { id: "team_1", name: "Acme Team", slug: "acme-team" },
    });
  });

  describe("given the caller arrived through a connection that is not live", () => {
    /** @scenario "A test arrival cannot create an organization" */
    it("refuses, and creates nothing", async () => {
      mockStandingFor.mockResolvedValue({
        connectionId: "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m",
        organizationId: "org_acme",
        organizationName: "Acme",
      });

      // The handled code, not the prose: crossing the tRPC boundary puts the
      // slug in `message` and the status class in `code` (#5984).
      await expect(
        createCaller().createAndAssign({ orgName: "Acme Corp" }),
      ).rejects.toMatchObject({
        message: "sso_test_arrival_cannot_create_organization",
        code: "CONFLICT",
      });

      expect(mockCreateAndAssign).not.toHaveBeenCalled();
    });
  });

  describe("given an ordinary new customer", () => {
    it("creates the organization", async () => {
      const result = await createCaller().createAndAssign({
        orgName: "Acme Corp",
      });

      expect(result.success).toBe(true);
      expect(mockCreateAndAssign).toHaveBeenCalled();
    });
  });
});
