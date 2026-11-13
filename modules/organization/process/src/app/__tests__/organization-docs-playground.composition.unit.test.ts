/**
 * Turning docs playground sessions off through `OrganizationModule.create` over the memory
 * registry: the policy commits, then organization records the fact api-key revokes keys on.
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import { describe, expect, it } from "vitest";

import type { RecordDocsPlaygroundSessionsDisabledCommandData } from "../../eventing/organization-lifecycle.events.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import type { OrganizationLifecycleSenders } from "../../services/organization-lifecycle-notice.service.ts";
import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const ADMIN = { id: "user-admin" };

type Recorded = {
  data: RecordDocsPlaygroundSessionsDisabledCommandData;
  enabledAtTheTime: boolean;
};

function lifecycleSenders({
  recorded,
  failing,
  enabledNow,
}: {
  recorded: Recorded[];
  failing: boolean;
  enabledNow: () => Promise<boolean>;
}): OrganizationLifecycleSenders {
  const accepts = { send: async () => undefined };
  return {
    recordCreated: accepts,
    recordSignedUp: accepts,
    recordMembersInvited: accepts,
    recordInviteAccepted: accepts,
    recordIntegrationMethodChosen: accepts,
    recordPersonalWorkspaceProvisioned: accepts,
    recordPersonalTeamCreated: accepts,
    recordPersonalWorkspaceArchived: accepts,
    recordPersonalWorkspaceRevived: accepts,
    recordPersonalWorkspaceFeaturesChanged: accepts,
    recordPresenceSettingChanged: { ...accepts, sendBatch: async () => undefined },
    recordMemberDisabled: accepts,
    recordMemberEnabled: accepts,
    recordMemberRemoved: accepts,
    recordMemberDepartmentChanged: accepts,
    recordTraceSharingDisabled: accepts,
    recordDocsPlaygroundSessionsDisabled: {
      send: async (data) => {
        if (failing) throw new Error("the event store refused");
        recorded.push({ data, enabledAtTheTime: await enabledNow() });
      },
    },
  };
}

async function application({ failing = false }: { failing?: boolean } = {}) {
  const permissions = TestAuthzApi.create({
    people: [{ id: ADMIN.id, name: "Ana", email: "ana@acme.test" }],
  });
  const recorded: Recorded[] = [];
  const memory = MemoryOrganizationDatabase.create();
  const setup = organizationModuleSetup({ permissions, memory });
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
      enabledNow: async () =>
        (await app.getDocsPlaygroundPolicy({ organizationId: ORGANIZATION_ID }))
          .docsPlaygroundSessionsEnabled,
    }),
  );

  return { app, recorded };
}

describe("given an organization whose docs playground sessions are on", () => {
  describe("when an admin turns them off", () => {
    /** @scenario "Turning the playground session off revokes the organisation's docs session keys" */
    it("records the fact naming the organization and the admin, after the policy commits", async () => {
      const { app, recorded } = await application();

      await app.saveDocsPlaygroundPolicy({
        organizationId: ORGANIZATION_ID,
        docsPlaygroundSessionsEnabled: false,
        changedByUserId: ADMIN.id,
      });

      expect(recorded).toEqual([
        {
          data: expect.objectContaining({
            tenantId: ORGANIZATION_ID,
            organizationId: ORGANIZATION_ID,
            changedByUserId: ADMIN.id,
          }),
          enabledAtTheTime: false,
        },
      ]);
    });
  });

  describe("when an admin turns them on", () => {
    it("records nothing, so no key is revoked", async () => {
      const { app, recorded } = await application();

      await app.saveDocsPlaygroundPolicy({
        organizationId: ORGANIZATION_ID,
        docsPlaygroundSessionsEnabled: true,
        changedByUserId: ADMIN.id,
      });

      expect(recorded).toEqual([]);
    });
  });

  describe("when the fact cannot be recorded", () => {
    it("fails loudly rather than leaving the keys live in silence", async () => {
      const { app } = await application({ failing: true });

      await expect(
        app.saveDocsPlaygroundPolicy({
          organizationId: ORGANIZATION_ID,
          docsPlaygroundSessionsEnabled: false,
        }),
      ).rejects.toThrow("the event store refused");
    });
  });
});
