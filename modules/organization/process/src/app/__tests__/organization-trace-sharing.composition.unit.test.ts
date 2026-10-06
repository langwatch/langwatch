/**
 * Turning trace sharing off through `OrganizationModule.create` over the memory registry: the
 * setting commits, then every project of the organization has its share links revoked.
 * @see modules/organization/specs/organization-service.feature
 */
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const ADMIN = { id: "user-admin" };

/** An organization with trace sharing on and the two projects `projectIds` names. */
async function application({ failingProject }: { failingProject?: string } = {}) {
  const permissions = TestAuthzApi.create({
    people: [{ id: ADMIN.id, name: "Ana", email: "ana@acme.test" }],
  });
  const revoked: { projectId: string; sharingEnabledAtTheTime: boolean }[] = [];
  const holder: { app?: OrganizationModule } = {};
  const setup = organizationModuleSetup({
    permissions,
    projects: createApiFixture<ProjectApi>(
      { listIdsByOrganization: async () => ["project-1", "project-2"] },
      "ProjectApi",
    ),
    shares: createApiFixture<ShareApi>(
      {
        revokeAllTraceShares: async (projectId: string) => {
          if (projectId === failingProject) throw new Error("the share store refused");
          const settings = await holder.app!.getSettings({ organizationId: ORGANIZATION_ID });
          revoked.push({ projectId, sharingEnabledAtTheTime: settings.traceSharingEnabled });
        },
      },
      "ShareApi",
    ),
  });
  await setup.repositories.membership(permissions).createAndAssign({
    userId: ADMIN.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-1",
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  const app = await OrganizationModule.create(setup);
  holder.app = app;
  await app.updateSettings({ organizationId: ORGANIZATION_ID, traceSharingEnabled: true }, ADMIN);

  return { app, revoked };
}

describe("given an organization with trace sharing enabled and two projects", () => {
  describe("when a management transport commits the settings with sharing turned off", () => {
    /** @scenario "Trace sharing is disabled for an organization" */
    it("revokes the trace shares of each project, after the setting is committed", async () => {
      const { app, revoked } = await application();

      await app.updateSettings(
        { organizationId: ORGANIZATION_ID, traceSharingEnabled: false },
        ADMIN,
      );

      expect(revoked).toEqual([
        { projectId: "project-1", sharingEnabledAtTheTime: false },
        { projectId: "project-2", sharingEnabledAtTheTime: false },
      ]);
    });
  });

  describe("when one project's shares cannot be revoked", () => {
    it("fails loudly naming that project, with the other project's shares revoked", async () => {
      const { app, revoked } = await application({ failingProject: "project-2" });

      await expect(
        app.updateSettings({ organizationId: ORGANIZATION_ID, traceSharingEnabled: false }, ADMIN),
      ).rejects.toThrow("project-2");

      expect(revoked.map((entry) => entry.projectId)).toEqual(["project-1"]);
    });
  });
});
