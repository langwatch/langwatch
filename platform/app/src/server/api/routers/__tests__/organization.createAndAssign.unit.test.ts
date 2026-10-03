import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SignUpPolicy,
  type SignUpPolicyConfig,
} from "~/server/app-layer/identity/sign-up-policy";
import { createInnerTRPCContext } from "../../trpc";

/**
 * The one door an organization is created through.
 *
 * `onboarding.initializeOrganization` delegates here, so this is where the
 * refusal has to live: a guard on the onboarding mutation is one this
 * procedure walks straight past, and the procedure is reachable on its own.
 */

const { mockCreateAndAssign, mockStandingFor, mockActivateConfigured } =
  vi.hoisted(() => ({
    mockCreateAndAssign: vi.fn(),
    mockStandingFor: vi.fn(),
    mockActivateConfigured: vi.fn(),
  }));

// The real policy over a fake installation: the config and the counts are
// what each case below changes.
const { policyState } = vi.hoisted(() => ({
  policyState: {
    config: {
      mode: "open",
      allowedDomains: [],
      adminEmails: [],
    } as SignUpPolicyConfig,
    organizationExists: true,
  },
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
  signUpPolicy: () =>
    new SignUpPolicy({
      config: () => policyState.config,
      repository: {
        hasPendingInvite: async () => false,
        findPendingInviteCode: async () => null,
        anyUserExists: async () => true,
        anyOrganizationExists: async () => policyState.organizationExists,
      },
    }),
}));

vi.mock("@ee/licensing/activation/configuredActivation", () => ({
  activateConfiguredLicenseForInstall: mockActivateConfigured,
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

import { organizationRouter } from "../organization";

function createCaller(email = "jane@example.com") {
  return organizationRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user_1", name: "Jane Doe", email },
        expires: "1",
      },
      permissionChecked: false,
    }),
  );
}

describe("organization.createAndAssign", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyState.config = { mode: "open", allowedDomains: [], adminEmails: [] };
    policyState.organizationExists = true;
    mockStandingFor.mockResolvedValue(null);
    mockActivateConfigured.mockResolvedValue({ outcome: "not_configured" });
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
      expect(mockActivateConfigured).not.toHaveBeenCalled();
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

    /** @scenario "an activation code on a fresh install waits for the first organization" */
    it("redeems a configured activation code once the organization exists", async () => {
      await createCaller().createAndAssign({ orgName: "Acme Corp" });

      expect(mockActivateConfigured).toHaveBeenCalledTimes(1);
      expect(
        mockActivateConfigured.mock.invocationCallOrder[0],
      ).toBeGreaterThan(mockCreateAndAssign.mock.invocationCallOrder[0]!);
    });
  });

  describe("when the installation is invite-only", () => {
    beforeEach(() => {
      policyState.config = {
        mode: "invite_only",
        allowedDomains: [],
        adminEmails: ["ops@acme.com"],
      };
    });

    describe("when a member who is not an instance administrator creates one", () => {
      it("refuses with the restricted code, and creates nothing", async () => {
        await expect(
          createCaller("jane@example.com").createAndAssign({
            orgName: "Side Org",
          }),
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          cause: { code: "organization_creation_restricted" },
        });

        expect(mockCreateAndAssign).not.toHaveBeenCalled();
        expect(mockActivateConfigured).not.toHaveBeenCalled();
      });
    });

    describe("when an instance administrator creates one", () => {
      it("creates the organization", async () => {
        const result = await createCaller("ops@acme.com").createAndAssign({
          orgName: "Acme Corp",
        });
        expect(result.success).toBe(true);
        expect(mockCreateAndAssign).toHaveBeenCalled();
      });
    });

    describe("when the installation has no organization yet", () => {
      it("lets the first account create it", async () => {
        policyState.organizationExists = false;
        const result = await createCaller("founder@acme.com").createAndAssign({
          orgName: "Acme Corp",
        });
        expect(result.success).toBe(true);
        expect(mockCreateAndAssign).toHaveBeenCalled();
      });
    });
  });

  describe("when the organization cannot be created", () => {
    it("does not redeem a configured activation code", async () => {
      mockCreateAndAssign.mockRejectedValue(new Error("insert failed"));

      await expect(
        createCaller().createAndAssign({ orgName: "Acme Corp" }),
      ).rejects.toThrow();

      expect(mockActivateConfigured).not.toHaveBeenCalled();
    });
  });
});
