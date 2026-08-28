/**
 * @vitest-environment node
 *
 * Pins what the organization's settings surface is told about its GitHub
 * connection, and what disconnecting hands back: the uninstall deep link
 * follows the host the instance is bound to, the install link disappears on an
 * instance that cannot start an installation, a member learns how wide a
 * "selected" install reaches without learning which repositories it names, and
 * an installation owned by another organization is reported as a missing one.
 */
import {
  GithubNotConnectedError,
  type GithubAppConfig,
  type GithubInstallation,
} from "@langwatch/github-contract";
import { describe, expect, it, vi } from "vitest";

import { GithubConnectionService } from "../src/services/github-connection.service";

function installation(overrides: Partial<GithubInstallation> = {}): GithubInstallation {
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
    ...overrides,
  };
}

function service({
  installations = [] as GithubInstallation[],
  byId = null as GithubInstallation | null,
  configured = true,
  webBase = "https://github.com",
} = {}) {
  const getAllForOrganization = vi.fn(async () => installations);
  const tryGetByInstallationId = vi.fn(async () => byId);
  const appConfig: GithubAppConfig = {
    appSlug: "langwatch-langy",
    webhookSecret: "whsecret",
    configured,
  };

  return {
    getAllForOrganization,
    tryGetByInstallationId,
    connection: GithubConnectionService.create({
      installations: { getAllForOrganization, tryGetByInstallationId },
      getAppConfig: () => appConfig,
      getWebBase: () => webBase,
    }),
  };
}

describe("GithubConnectionService", () => {
  describe("given the instance is bound to a GitHub Enterprise Server host", () => {
    /** @scenario "The uninstall link points at the configured host" */
    it("points the uninstall link at that host", async () => {
      const { connection } = service({
        installations: [installation()],
        webBase: "https://github.acme-corp.internal",
      });

      const status = await connection.getConnectionStatus({ organizationId: "org-1" });

      expect(status.installations[0]?.uninstallUrl).toBe(
        "https://github.acme-corp.internal/organizations/acme/settings/installations/555",
      );
    });

    it("uses the personal-account path for a user installation", async () => {
      const { connection } = service({
        installations: [installation({ accountType: "User", accountLogin: "octocat" })],
      });

      const status = await connection.getConnectionStatus({ organizationId: "org-1" });

      expect(status.installations[0]?.uninstallUrl).toBe(
        "https://github.com/settings/installations/555",
      );
    });
  });

  describe("when the instance cannot start an installation", () => {
    /** @scenario "An instance that cannot start an installation offers no install link" */
    it("hands back no install link and reports itself unconfigured", async () => {
      const { connection } = service({ configured: false });

      const status = await connection.getConnectionStatus({ organizationId: "org-1" });

      expect(status.installUrl).toBeNull();
      expect(status.configured).toBe(false);
    });
  });

  describe("when the organization has a selected-repository installation", () => {
    /** @scenario "Any member can see whether GitHub is connected" */
    it("reports how many repositories it covers, never their names", async () => {
      const { connection } = service({
        installations: [
          installation({
            repositorySelection: "selected",
            repositories: [{ id: "77", fullName: "acme/service-x" }],
          }),
        ],
      });

      const status = await connection.getConnectionStatus({ organizationId: "org-1" });

      expect(status.connected).toBe(true);
      expect(status.installations[0]?.repositoryCount).toBe(1);
      expect(JSON.stringify(status)).not.toContain("service-x");
    });

    it("leaves the count unknown for an installation covering every repository", async () => {
      const { connection } = service({ installations: [installation()] });

      const status = await connection.getConnectionStatus({ organizationId: "org-1" });

      expect(status.installations[0]?.repositoryCount).toBeNull();
    });
  });

  describe("when the installation is suspended", () => {
    it("says so", async () => {
      const { connection } = service({
        installations: [installation({ suspendedAt: new Date() })],
      });

      const status = await connection.getConnectionStatus({ organizationId: "org-1" });

      expect(status.installations[0]?.suspended).toBe(true);
    });
  });

  describe("when disconnecting an installation the organization owns", () => {
    it("hands back the uninstall deep link", async () => {
      const { connection } = service({ byId: installation() });

      const result = await connection.disconnect({
        organizationId: "org-1",
        installationId: "555",
      });

      expect(result.uninstallUrl).toBe(
        "https://github.com/organizations/acme/settings/installations/555",
      );
    });
  });

  describe("when the installation belongs to another organization", () => {
    it("reports it exactly as a missing connection", async () => {
      const { connection } = service({
        byId: installation({ organizationId: "someone-else" }),
      });

      await expect(
        connection.disconnect({ organizationId: "org-1", installationId: "555" }),
      ).rejects.toBeInstanceOf(GithubNotConnectedError);
    });
  });

  describe("when no installation carries the id", () => {
    it("reports a missing connection", async () => {
      const { connection } = service({ byId: null });

      await expect(
        connection.disconnect({ organizationId: "org-1", installationId: "555" }),
      ).rejects.toMatchObject({ code: "github_not_connected" });
    });
  });
});
