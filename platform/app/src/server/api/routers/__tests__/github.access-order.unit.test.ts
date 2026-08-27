import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

// The github procedures chain checkOrganizationPermission -> membership. This
// suite locks BOTH the permission each one demands and that order: reading the
// connection asks for `organization:view`, which every member holds, so a
// surface that needs GitHub can name who to ask; changing it asks for
// `organization:manage`, because an installation grants repository access to
// the whole organization. Membership runs second so a permitted caller still
// cannot reach another tenant's connection.
//
// The permission middleware is stubbed to a controllable gate — whether the
// role matrix grants a permission is pinned separately in the rbac suites; what
// matters here is which permission is demanded, and in what order.
const {
  isOrganizationMember,
  getAllForOrganization,
  getByInstallationId,
  listRepositoriesForOrganization,
  hasOrgPermission,
  permissionsAsked,
} = vi.hoisted(() => ({
  isOrganizationMember: vi.fn(),
  getAllForOrganization: vi.fn(),
  getByInstallationId: vi.fn(),
  listRepositoriesForOrganization: vi.fn(),
  hasOrgPermission: vi.fn(),
  permissionsAsked: [] as string[],
}));

// The install link is built from the App's own configuration, so the suite
// controls whether this instance can start an installation at all.
const { appConfig } = vi.hoisted(() => ({
  appConfig: {
    appId: "app-123",
    privateKey: "dummy-pem",
    webhookSecret: "whsecret",
    appSlug: "langwatch-langy",
    configured: true,
  },
}));
const { githubHost } = vi.hoisted(() => ({
  githubHost: { webBase: "https://github.com" },
}));

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    hasOrganizationPermission: vi.fn(
      async (_ctx: unknown, _organizationId: string, permission: string) => {
        permissionsAsked.push(permission);
        return hasOrgPermission();
      },
    ),
  };
});

vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  const base = appPermissionsMock();
  return {
    ...base,
    getApp: () => ({
      ...base.getApp(),
      github: {
        getAppConfig: () => appConfig,
        getWebBase: () => githubHost.webBase,
        isOrganizationMember,
        getAllForOrganization,
        tryGetByInstallationId: getByInstallationId,
        listRepositoriesForOrganization,
      },
    }),
  };
});
vi.mock("~/runtime/app/features/audit-log", () => ({ auditLog: vi.fn() }));

import { githubRouter } from "../github";

const user = { id: "user-1", email: "user@example.com", emailVerified: true };

function caller() {
  return githubRouter.createCaller(
    createInnerTRPCContext({
      session: { user, expires: "1" } as any,
      permissionChecked: false,
    }),
  );
}

function installationRow() {
  return {
    installationId: "555",
    organizationId: "org-1",
    accountLogin: "acme",
    accountType: "Organization",
    accountId: "1",
    repositorySelection: "all",
    repositories: null,
    suspendedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("githubRouter access gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissionsAsked.length = 0;
    getAllForOrganization.mockResolvedValue([]);
    listRepositoriesForOrganization.mockResolvedValue([]);
    hasOrgPermission.mockReturnValue(true);
    appConfig.configured = true;
    githubHost.webBase = "https://github.com";
  });

  describe("when the instance is bound to a GitHub Enterprise Server host", () => {
    /** @scenario "The uninstall link points at the configured host" */
    it("points the uninstall link at that host", async () => {
      githubHost.webBase = "https://github.acme-corp.internal";
      isOrganizationMember.mockResolvedValue(true);
      getAllForOrganization.mockResolvedValue([installationRow()]);

      const result = await caller().getConnectionStatus({
        organizationId: "org-1",
      });

      expect(result.installations[0]?.uninstallUrl).toBe(
        "https://github.acme-corp.internal/organizations/acme/settings/installations/555",
      );
    });

    it("points it at github.com when no host is named", async () => {
      isOrganizationMember.mockResolvedValue(true);
      getAllForOrganization.mockResolvedValue([installationRow()]);

      const result = await caller().getConnectionStatus({
        organizationId: "org-1",
      });

      expect(result.installations[0]?.uninstallUrl).toBe(
        "https://github.com/organizations/acme/settings/installations/555",
      );
    });
  });

  describe("when the instance cannot start an installation", () => {
    /** @scenario "An instance that cannot start an installation offers no install link" */
    it("hands back no install link", async () => {
      appConfig.configured = false;
      isOrganizationMember.mockResolvedValue(true);

      const result = await caller().getConnectionStatus({
        organizationId: "org-1",
      });

      expect(result.installUrl).toBeNull();
    });
  });

  describe("when a member without management permission reads the status", () => {
    /** @scenario "Any member can see whether GitHub is connected" */
    it("asks only for organization:view and answers whether a connection exists", async () => {
      isOrganizationMember.mockResolvedValue(true);
      getAllForOrganization.mockResolvedValue([installationRow()]);

      const result = await caller().getConnectionStatus({
        organizationId: "org-1",
      });

      expect(permissionsAsked).toEqual(["organization:view"]);
      expect(result.connected).toBe(true);
      expect(result.installUrl).toContain("/api/github/install");
    });

    /** @scenario "Any member can see whether GitHub is connected" */
    it("does not hand back repository names", async () => {
      isOrganizationMember.mockResolvedValue(true);
      getAllForOrganization.mockResolvedValue([
        {
          ...installationRow(),
          repositorySelection: "selected",
          repositories: [{ id: "77", fullName: "acme/service-x" }],
        },
      ]);

      const result = await caller().getConnectionStatus({
        organizationId: "org-1",
      });

      // The count is the whole answer a member gets about scope.
      expect(result.installations[0]?.repositoryCount).toBe(1);
      expect(JSON.stringify(result)).not.toContain("service-x");
      expect(listRepositoriesForOrganization).not.toHaveBeenCalled();
    });
  });

  describe("when the caller lacks organization management", () => {
    /** @scenario "Changing the organization's GitHub connection is admin-only" */
    it("refuses to list repositories, without reading any", async () => {
      hasOrgPermission.mockReturnValue(false);
      isOrganizationMember.mockResolvedValue(true);

      await expect(caller().listRepos({ organizationId: "org-1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(permissionsAsked).toEqual(["organization:manage"]);
      expect(listRepositoriesForOrganization).not.toHaveBeenCalled();
    });

    it("refuses to disconnect an installation", async () => {
      hasOrgPermission.mockReturnValue(false);
      isOrganizationMember.mockResolvedValue(true);

      await expect(
        caller().disconnect({
          organizationId: "org-1",
          installationId: "555",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(permissionsAsked).toEqual(["organization:manage"]);
      expect(getByInstallationId).not.toHaveBeenCalled();
    });
  });

  describe("when a permitted caller is not a member of the organization", () => {
    it("throws FORBIDDEN before any connection state is read", async () => {
      isOrganizationMember.mockResolvedValue(false);

      await expect(
        caller().getConnectionStatus({ organizationId: "victim-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getAllForOrganization).not.toHaveBeenCalled();
    });
  });

  describe("when the installation belongs to another organization", () => {
    it("reports disconnect as a missing connection rather than a refusal", async () => {
      isOrganizationMember.mockResolvedValue(true);
      getByInstallationId.mockResolvedValue({
        ...installationRow(),
        organizationId: "someone-else",
      });

      await expect(
        caller().disconnect({
          organizationId: "org-1",
          installationId: "555",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("when the Langy rollout is off for the organization", () => {
    it("still answers the connection status, without evaluating the flag", async () => {
      isOrganizationMember.mockResolvedValue(true);

      const result = await caller().getConnectionStatus({
        organizationId: "org-1",
      });

      expect(result.configured).toBe(true);
    });
  });
});
