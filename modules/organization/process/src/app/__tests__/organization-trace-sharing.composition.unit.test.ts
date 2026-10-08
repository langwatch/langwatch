/**
 * Turning trace sharing off through `OrganizationModule.create` over the memory registry: the
 * setting commits, then organization records the fact naming every project; share revokes.
 * @see modules/organization/specs/organization-service.feature
 */
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { RecordTraceSharingDisabledCommandData } from "../../eventing/organization-lifecycle.events.ts";
import type { OrganizationLifecycleSenders } from "../../services/organization-lifecycle-notice.service.ts";
import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const ADMIN = { id: "user-admin" };

/** Every lifecycle sender accepts; the trace sharing one notes what it was sent and when. */
function lifecycleSenders({
  recorded,
  failing,
  sharingEnabledNow,
}: {
  recorded: { data: RecordTraceSharingDisabledCommandData; sharingEnabledAtTheTime: boolean }[];
  failing: boolean;
  sharingEnabledNow: () => Promise<boolean>;
}): OrganizationLifecycleSenders {
  const accepts = { send: async () => undefined };
  return {
    recordSignedUp: accepts,
    recordMembersInvited: accepts,
    recordInviteAccepted: accepts,
    recordIntegrationMethodChosen: accepts,
    recordPersonalWorkspaceProvisioned: accepts,
    recordPresenceSettingChanged: accepts,
    recordTraceSharingDisabled: {
      send: async (data) => {
        if (failing) throw new Error("the event store refused");
        recorded.push({ data, sharingEnabledAtTheTime: await sharingEnabledNow() });
      },
    },
  };
}

/** An organization with trace sharing on and the two projects `listIdsByOrganization` names. */
async function application({ failing = false }: { failing?: boolean } = {}) {
  const permissions = TestAuthzApi.create({
    people: [{ id: ADMIN.id, name: "Ana", email: "ana@acme.test" }],
  });
  const recorded: {
    data: RecordTraceSharingDisabledCommandData;
    sharingEnabledAtTheTime: boolean;
  }[] = [];
  const setup = organizationModuleSetup({
    permissions,
    projects: createApiFixture<ProjectApi>(
      { listIdsByOrganization: async () => ["project-1", "project-2"] },
      "ProjectApi",
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
  app.connectLifecycle(
    lifecycleSenders({
      recorded,
      failing,
      sharingEnabledNow: async () =>
        (await app.getSettings({ organizationId: ORGANIZATION_ID })).traceSharingEnabled,
    }),
  );
  await app.updateSettings({ organizationId: ORGANIZATION_ID, traceSharingEnabled: true }, ADMIN);

  return { app, recorded };
}

describe("given an organization with trace sharing enabled and two projects", () => {
  describe("when a management transport commits the settings with sharing turned off", () => {
    /** @scenario "Trace sharing is disabled for an organization" */
    it("records trace sharing disabled naming each project, after the setting is committed", async () => {
      const { app, recorded } = await application();

      await app.updateSettings(
        { organizationId: ORGANIZATION_ID, traceSharingEnabled: false },
        ADMIN,
      );

      expect(recorded).toEqual([
        {
          data: expect.objectContaining({
            tenantId: ORGANIZATION_ID,
            organizationId: ORGANIZATION_ID,
            projectIds: ["project-1", "project-2"],
            changedByUserId: ADMIN.id,
          }),
          sharingEnabledAtTheTime: false,
        },
      ]);
    });
  });

  describe("when sharing was already off", () => {
    it("records nothing", async () => {
      const { app, recorded } = await application();
      await app.updateSettings(
        { organizationId: ORGANIZATION_ID, traceSharingEnabled: false },
        ADMIN,
      );
      recorded.length = 0;

      await app.updateSettings(
        { organizationId: ORGANIZATION_ID, traceSharingEnabled: false },
        ADMIN,
      );

      expect(recorded).toEqual([]);
    });
  });

  describe("when the fact cannot be recorded", () => {
    it("fails loudly rather than leaving the links unrevoked in silence", async () => {
      const { app } = await application({ failing: true });

      await expect(
        app.updateSettings({ organizationId: ORGANIZATION_ID, traceSharingEnabled: false }, ADMIN),
      ).rejects.toThrow("the event store refused");
    });
  });
});
