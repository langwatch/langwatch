/**
 * The GitHub connection, served by the API process.
 *
 * Booted over the memory repositories rather than a Prisma double: the point of
 * the installer is that persistence is chosen once, at boot, so the same graph
 * this test drives is the one `installApiGithub` builds over Postgres.
 */
import { githubServer } from "@langwatch/github-server";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

const ORGANIZATION_ID = "organization-1";

const REGISTERED_APP = {
  appId: "123456",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nnot-a-key\n-----END RSA PRIVATE KEY-----",
  appSlug: "langwatch-test",
  webhookSecret: "webhook-secret",
};

async function bootGithub(config: Record<string, string | undefined> = REGISTERED_APP) {
  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(OrganizationApi, createApiFixture<OrganizationApi>())
    .withProvided(ProjectApi, createApiFixture<ProjectApi>())
    .withModule(githubServer, {
      infrastructure: { redis: null, signingKey: "signing-key" },
    })
    .boot({ role: "api", config: { github: config } });

  return runtime.module(githubServer).provided;
}

describe("given the API process installs the GitHub module", () => {
  describe("when the deployment registered a GitHub App", () => {
    it("reports an organization with no installation as connectable but not connected", async () => {
      const github = await bootGithub();

      const status = await github.getConnectionStatus({ organizationId: ORGANIZATION_ID });

      expect(status.configured).toBe(true);
      expect(status.connected).toBe(false);
      expect(status.installations).toEqual([]);
      expect(status.installUrl).toContain("/api/github/install");
    });

    it("answers the pull-request reads from its own rows", async () => {
      const github = await bootGithub();

      await expect(
        github.findAllByBranches({
          organizationId: ORGANIZATION_ID,
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          headBranches: ["feat/one"],
        }),
      ).resolves.toEqual([]);
    });
  });

  describe("when the deployment registered no GitHub App", () => {
    it("reports the connection as unconfigured rather than failing the call", async () => {
      const github = await bootGithub({});

      const status = await github.getConnectionStatus({ organizationId: ORGANIZATION_ID });

      expect(status.configured).toBe(false);
      expect(status.installUrl).toBeNull();
    });
  });
});
