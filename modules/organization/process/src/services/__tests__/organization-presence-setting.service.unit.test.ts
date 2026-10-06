/**
 * @vitest-environment node
 * Organization records its presence switch as a fact presence folds from its own side (§9).
 * @see modules/organization/specs/organization-service.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import type { RecordPresenceSettingChangedCommandData } from "../../eventing/organization-lifecycle.events.ts";
import type { GroupRepository } from "../../repositories/group.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import type { TeamRepository } from "../../repositories/team.repository.ts";
import { OrganizationPresenceSettingBackfillTask } from "../../tasks/organization-presence-setting-backfill.task.ts";
import type { GroupIdentity } from "../group-identity.service.ts";
import { OrganizationLifecycleNoticeService } from "../organization-lifecycle-notice.service.ts";
import { OrganizationService, type OrganizationSettingsNotices } from "../organization.service.ts";
import type { PersonalWorkspaceIdentity } from "../personal-workspace-identity.service.ts";
import type { TeamIdentity } from "../team-identity.service.ts";

const ADMIN = { id: "user_admin" };

let database: MemoryOrganizationDatabase;

function seedOrganization(id: string, presenceEnabled: boolean): void {
  const now = nowInstant();
  database.organizations.set(id, {
    id,
    name: id,
    slug: id,
    supportContact: null,
    presenceEnabled,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: now,
    updatedAt: now,
  });
}

function serviceOver(settingsNotices: OrganizationSettingsNotices): OrganizationService {
  const authz = createApiFixture<AuthzApi>();
  return OrganizationService.create({
    repository: MemoryOrganizationRepository.create({ memory: database }),
    teams: createApiFixture<TeamRepository>(),
    groups: createApiFixture<GroupRepository>(),
    identities: createApiFixture<PersonalWorkspaceIdentity>(),
    teamIdentities: createApiFixture<TeamIdentity>(),
    groupIdentities: createApiFixture<GroupIdentity>(),
    authz,
    grants: authz,
    settingsNotices,
  });
}

type PresenceChange = Parameters<OrganizationSettingsNotices["presenceSettingChanged"]>[0];

function recordingNotices(changes: PresenceChange[]): OrganizationSettingsNotices {
  return createApiFixture<OrganizationSettingsNotices>({
    presenceSettingChanged: (change) => {
      changes.push(change);
    },
  });
}

beforeEach(() => {
  database = MemoryOrganizationDatabase.create();
});

describe("given an organization whose presence setting is on", () => {
  beforeEach(() => seedOrganization("org_acme", true));

  describe("when an administrator saves the settings with presence off", () => {
    /** @scenario "A changed organization presence setting is recorded as organization's fact" */
    it("records the change with the administrator who made it", async () => {
      const changes: PresenceChange[] = [];

      await serviceOver(recordingNotices(changes)).updateSettings(
        { organizationId: "org_acme", presenceEnabled: false },
        ADMIN,
      );

      expect(changes).toEqual([
        { organizationId: "org_acme", presenceEnabled: false, changedByUserId: "user_admin" },
      ]);
      expect(database.organizations.get("org_acme")?.presenceEnabled).toBe(false);
    });
  });

  describe("when an administrator saves the settings with presence unchanged or absent", () => {
    /** @scenario "Saving organization settings without changing presence records no presence fact" */
    it("records no presence fact", async () => {
      const changes: PresenceChange[] = [];
      const service = serviceOver(recordingNotices(changes));

      await service.updateSettings({ organizationId: "org_acme", presenceEnabled: true }, ADMIN);
      await service.updateSettings({ organizationId: "org_acme", name: "Renamed" }, ADMIN);

      expect(changes).toEqual([]);
    });
  });
});

describe("given two organizations whose presence settings were stored before they were recorded", () => {
  beforeEach(() => {
    seedOrganization("org_acme", true);
    seedOrganization("org_globex", false);
  });

  describe("when the backfill-organization-presence-setting task runs twice", () => {
    /** @scenario "Existing organizations' presence settings are recorded by the backfill, idempotently" */
    it("records each stored setting once per run, marked backfilled, with no changer", async () => {
      const sent: RecordPresenceSettingChangedCommandData[] = [];
      const notices = OrganizationLifecycleNoticeService.create({
        reportError: (error) => {
          throw error;
        },
      });
      const idle = { send: async () => undefined };
      notices.connect({
        recordSignedUp: idle,
        recordMembersInvited: idle,
        recordInviteAccepted: idle,
        recordIntegrationMethodChosen: idle,
        recordPersonalWorkspaceProvisioned: idle,
        recordPresenceSettingChanged: {
          send: async (data) => {
            sent.push(data);
          },
        },
      });
      const service = serviceOver(notices);
      const repository = MemoryOrganizationRepository.create({ memory: database });
      const task = OrganizationPresenceSettingBackfillTask.create({
        organizations: {
          findAllIds: () => repository.findAllIds(),
          recordStoredPresenceSetting: (input) => service.recordStoredPresenceSetting(input),
        },
      });
      const backfill = () => task.run({ args: [], signal: new AbortController().signal });

      await backfill();
      const firstRun = sent.map(({ occurredAt: _at, ...rest }) => rest);
      sent.length = 0;
      await backfill();

      expect(firstRun).toEqual([
        {
          tenantId: "org_acme",
          organizationId: "org_acme",
          presenceEnabled: true,
          backfilled: true,
        },
        {
          tenantId: "org_globex",
          organizationId: "org_globex",
          presenceEnabled: false,
          backfilled: true,
        },
      ]);
      expect(sent.map(({ occurredAt: _at, ...rest }) => rest)).toEqual(firstRun);
    });
  });
});
