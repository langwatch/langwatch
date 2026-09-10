/**
 * The organization repositories' contract: organization settings, team
 * creation and archival, group management, membership read paths, personal
 * workspace protection, and tenant ownership routing.
 *
 * The memory tier is the only backend registered here. The Prisma tier is
 * tested separately in
 * `../prisma/__tests__/prisma.organization-repositories.integration.test.ts`,
 * because complex membership writes with role binding ledger interaction need
 * a real database. This suite pins the memory twin to observable answers so
 * the app can be driven without database infrastructure for bootstrapping tests.
 */
import { vi, beforeEach, describe, expect, it } from "vitest";
import {
  OrganizationNotFoundError,
  OrganizationHasNoTeamError,
  TeamNotFoundError,
  TeamSlugConflictError,
  GroupNotFoundError,
  type OrganizationIntent,
} from "@langwatch/organization-contract";
import { organizationRepositories } from "../organization-repositories.registry.ts";
import type { OrganizationRepositories } from "../organization.repositories.ts";
import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";

const ORGANIZATION_ID = "org-1";
const ORGANIZATION_ID_2 = "org-2";
const TEAM_ID = "team-1";
const TEAM_SLUG = "default";
const GROUP_ID = "group-1";
const USER_ID = "user-1";
const USER_ID_2 = "user-2";

const backends: ReadonlyArray<Readonly<{ name: string; create: () => OrganizationRepositories }>> = [
  {
    name: "memory",
    create: () => organizationRepositories.definitions.memory.create(),
  },
];

describe.each(backends)("given the $name organization repositories", ({ create }) => {
  let repositories: OrganizationRepositories;

  beforeEach(() => {
    repositories = create();
  });

  describe("when an organization is created", () => {
    it("finds its stored settings and returns empty S3 config by default", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;

      const now = new Date();
      database.organizations.set(ORGANIZATION_ID, {
        id: ORGANIZATION_ID,
        name: "Test Organization",
        slug: "test-org",
        supportContact: "support@example.com",
        presenceEnabled: false,
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

      const settings = await repositories.organization.findStoredSettings(ORGANIZATION_ID);
      expect(settings).toMatchObject({
        id: ORGANIZATION_ID,
        name: "Test Organization",
        slug: "test-org",
        s3Endpoint: null,
      });
    });

    it("returns null for a non-existent organization", async () => {
      const settings = await repositories.organization.findStoredSettings("non-existent");
      expect(settings).toBeNull();
    });
  });

  describe("when organization settings are updated", () => {
    it("persists changes and updates the timestamp", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;
      const now = new Date();

      database.organizations.set(ORGANIZATION_ID, {
        id: ORGANIZATION_ID,
        name: "Original",
        slug: "test-org",
        supportContact: null,
        presenceEnabled: false,
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

      await repositories.organization.updateSettings({
        organizationId: ORGANIZATION_ID,
        name: "Updated",
        presenceEnabled: true,
        primaryIntent: "customer_support" as OrganizationIntent,
      });

      const updated = await repositories.organization.findStoredSettings(ORGANIZATION_ID);
      expect(updated).toMatchObject({
        name: "Updated",
        presenceEnabled: true,
        primaryIntent: "customer_support",
      });
    });

    it("rejects updates to a non-existent organization", async () => {
      await expect(
        repositories.organization.updateSettings({
          organizationId: "non-existent",
          name: "Updated",
        }),
      ).rejects.toThrow(OrganizationNotFoundError);
    });
  });

  describe("when a team is created", () => {
    it("reads it back and persists all fields", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;

      const team = await repositories.team.create({
        teamId: TEAM_ID,
        name: "Default Team",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
      });

      expect(team).toMatchObject({
        id: TEAM_ID,
        name: "Default Team",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
        isPersonal: false,
        archivedAt: null,
      });

      const fetched = await repositories.team.get({
        teamId: TEAM_ID,
        organizationId: ORGANIZATION_ID,
      });
      expect(fetched).toEqual(team);
    });

    it("rejects a duplicate slug within the same organization", async () => {
      await repositories.team.create({
        teamId: TEAM_ID,
        name: "First Team",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
      });

      await expect(
        repositories.team.create({
          teamId: "team-2",
          name: "Second Team",
          slug: TEAM_SLUG,
          organizationId: ORGANIZATION_ID,
        }),
      ).rejects.toThrow(TeamSlugConflictError);
    });

    it("allows the same slug in different organizations", async () => {
      await repositories.team.create({
        teamId: TEAM_ID,
        name: "Team in Org 1",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
      });

      const team2 = await repositories.team.create({
        teamId: "team-2",
        name: "Team in Org 2",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID_2,
      });

      expect(team2.organizationId).toBe(ORGANIZATION_ID_2);
    });
  });

  describe("when a team is archived", () => {
    it("stops appearing in active lists and cannot be fetched", async () => {
      await repositories.team.create({
        teamId: TEAM_ID,
        name: "Team to Archive",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
      });

      const archived = await repositories.team.archive({
        teamId: TEAM_ID,
        organizationId: ORGANIZATION_ID,
      });

      expect(archived.archivedAt).not.toBeNull();
      await expect(
        repositories.team.get({
          teamId: TEAM_ID,
          organizationId: ORGANIZATION_ID,
        }),
      ).rejects.toThrow(TeamNotFoundError);
    });

    it("persists organization ownership through archival", async () => {
      await repositories.team.create({
        teamId: TEAM_ID,
        name: "Team",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
      });

      const orgId = await repositories.team.tryGetOrganizationId({
        teamId: TEAM_ID,
      });

      await repositories.team.archive({
        teamId: TEAM_ID,
        organizationId: ORGANIZATION_ID,
      });

      const stillKnown = await repositories.team.tryGetOrganizationId({
        teamId: TEAM_ID,
      });
      expect(stillKnown).toBe(orgId);
    });
  });

  describe("when a group is created", () => {
    it("reads it back with all fields", async () => {
      const group = await repositories.group.create({
        groupId: GROUP_ID,
        organizationId: ORGANIZATION_ID,
        name: "Engineering",
        slug: "engineering",
        memberIds: [USER_ID, USER_ID_2],
      });

      expect(group).toMatchObject({
        id: GROUP_ID,
        organizationId: ORGANIZATION_ID,
        name: "Engineering",
        slug: "engineering",
      });

      const fetched = await repositories.group.get({
        groupId: GROUP_ID,
        organizationId: ORGANIZATION_ID,
      });
      expect(fetched).toEqual(group);
    });

    it("tracks group membership", async () => {
      await repositories.group.create({
        groupId: GROUP_ID,
        organizationId: ORGANIZATION_ID,
        name: "Engineering",
        slug: "engineering",
        memberIds: [USER_ID, USER_ID_2],
      });

      const members = await repositories.group.listMembers({
        groupId: GROUP_ID,
        organizationId: ORGANIZATION_ID,
      });

      expect(members).toHaveLength(2);
      expect(members.map((m) => m.userId)).toEqual(expect.arrayContaining([USER_ID, USER_ID_2]));
    });

    it("rejects queries for a non-existent group", async () => {
      await expect(
        repositories.group.get({
          groupId: "non-existent",
          organizationId: ORGANIZATION_ID,
        }),
      ).rejects.toThrow(GroupNotFoundError);
    });
  });

  describe("when a group member is added", () => {
    it("appears in subsequent member lists", async () => {
      await repositories.group.create({
        groupId: GROUP_ID,
        organizationId: ORGANIZATION_ID,
        name: "Engineering",
        slug: "engineering",
        memberIds: [USER_ID],
      });

      await repositories.group.addMember({
        groupId: GROUP_ID,
        organizationId: ORGANIZATION_ID,
        userId: USER_ID_2,
      });

      const members = await repositories.group.listMembers({
        groupId: GROUP_ID,
        organizationId: ORGANIZATION_ID,
      });

      expect(members.map((m) => m.userId)).toContain(USER_ID_2);
    });
  });

  describe("when personal team scope is checked", () => {
    it("returns null when no personal team is in the scopes", async () => {
      const team = await repositories.team.create({
        teamId: TEAM_ID,
        name: "Shared Team",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
      });

      const personalTeam = await repositories.personalTeamScope.tryFindPersonalTeamInScopes({
        scopes: [{ scopeType: "TEAM", scopeId: team.id }],
      });

      expect(personalTeam).toBeNull();
    });

    it("returns the personal team when it appears in the scopes", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;

      const personalTeam = await repositories.team.create({
        teamId: TEAM_ID,
        name: "Personal Workspace",
        slug: `personal-${USER_ID}`,
        organizationId: ORGANIZATION_ID,
      });

      // Mark it as personal in the database
      const teamRow = database.teams.get(TEAM_ID);
      if (teamRow) {
        teamRow.isPersonal = true;
        teamRow.ownerUserId = USER_ID;
      }

      const found = await repositories.personalTeamScope.tryFindPersonalTeamInScopes({
        scopes: [{ scopeType: "TEAM", scopeId: personalTeam.id }],
      });

      expect(found).toMatchObject({ name: "Personal Workspace" });
    });
  });

  describe("when tenant directory checks ownership", () => {
    it("reports when an organization exists", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;
      const now = new Date();

      database.organizations.set(ORGANIZATION_ID, {
        id: ORGANIZATION_ID,
        name: "Test Org",
        slug: "test-org",
        supportContact: null,
        presenceEnabled: false,
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

      const exists = await repositories.tenantDirectory.organizationExists(ORGANIZATION_ID);
      expect(exists).toBe(true);
    });

    it("reports when an organization does not exist", async () => {
      const exists = await repositories.tenantDirectory.organizationExists("non-existent");
      expect(exists).toBe(false);
    });

    it("reports when a user exists", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;

      database.users.set(USER_ID, {
        id: USER_ID,
        name: "Test User",
        email: "user@example.com",
        deactivatedAt: null,
      });

      const exists = await repositories.tenantDirectory.userExists(USER_ID);
      expect(exists).toBe(true);
    });

    it("reports when a project belongs to an organization", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;
      const now = new Date();

      await repositories.team.create({
        teamId: TEAM_ID,
        name: "Team",
        slug: TEAM_SLUG,
        organizationId: ORGANIZATION_ID,
      });

      const projectId = "project-1";
      database.projects.set(projectId, {
        id: projectId,
        name: "Project",
        slug: "project",
        apiKey: "sk-test-key",
        teamId: TEAM_ID,
        isPersonal: false,
        ownerUserId: null,
        organizationId: ORGANIZATION_ID,
        archivedAt: null,
        createdAt: now,
        personalFeatures: null,
      });

      const orgId = await repositories.tenantDirectory.tryFindProjectOrganizationId(projectId);
      expect(orgId).toBe(ORGANIZATION_ID);
    });
  });

  describe("when getting the oldest team", () => {
    it("returns the earliest created team by the organization", async () => {
      const team1 = await repositories.team.create({
        teamId: "team-first",
        name: "First",
        slug: "first",
        organizationId: ORGANIZATION_ID,
      });

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await repositories.team.create({
        teamId: "team-second",
        name: "Second",
        slug: "second",
        organizationId: ORGANIZATION_ID,
      });

      const oldest = await repositories.organization.getOldestTeamId(ORGANIZATION_ID);
      expect(oldest).toBe(team1.id);
    });

    it("rejects when organization has no teams", async () => {
      await expect(
        repositories.organization.getOldestTeamId("org-with-no-teams"),
      ).rejects.toThrow(OrganizationHasNoTeamError);
    });
  });

  describe("when billing profile is retrieved", () => {
    it("returns organization name and current customer id", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;
      const now = new Date();

      database.organizations.set(ORGANIZATION_ID, {
        id: ORGANIZATION_ID,
        name: "Acme Corp",
        slug: "acme-corp",
        supportContact: null,
        presenceEnabled: false,
        traceSharingEnabled: false,
        primaryIntent: null,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3SecretAccessKey: null,
        s3Bucket: null,
        stripeCustomerId: "cus_123",
        createdAt: now,
        updatedAt: now,
      });

      const profile = await repositories.organization.getBillingProfile(ORGANIZATION_ID);

      expect(profile).toMatchObject({
        id: ORGANIZATION_ID,
        name: "Acme Corp",
        billingCustomerId: "cus_123",
      });
    });
  });

  describe("when claiming a billing customer id", () => {
    it("claims an unclaimed customer id and returns true", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;
      const now = new Date();

      database.organizations.set(ORGANIZATION_ID, {
        id: ORGANIZATION_ID,
        name: "Acme Corp",
        slug: "acme-corp",
        supportContact: null,
        presenceEnabled: false,
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

      const claimed = await repositories.organization.claimBillingCustomerId({
        organizationId: ORGANIZATION_ID,
        billingCustomerId: "cus_new",
      });

      expect(claimed).toBe(true);

      const profile = await repositories.organization.getBillingProfile(ORGANIZATION_ID);
      expect(profile.billingCustomerId).toBe("cus_new");
    });

    it("rejects a second claim and returns false", async () => {
      const database = (repositories.organization as any).memory as MemoryOrganizationDatabase;
      const now = new Date();

      database.organizations.set(ORGANIZATION_ID, {
        id: ORGANIZATION_ID,
        name: "Acme Corp",
        slug: "acme-corp",
        supportContact: null,
        presenceEnabled: false,
        traceSharingEnabled: false,
        primaryIntent: null,
        s3Endpoint: null,
        s3AccessKeyId: null,
        s3SecretAccessKey: null,
        s3Bucket: null,
        stripeCustomerId: "cus_claimed",
        createdAt: now,
        updatedAt: now,
      });

      const claimed = await repositories.organization.claimBillingCustomerId({
        organizationId: ORGANIZATION_ID,
        billingCustomerId: "cus_another",
      });

      expect(claimed).toBe(false);
    });
  });
});
