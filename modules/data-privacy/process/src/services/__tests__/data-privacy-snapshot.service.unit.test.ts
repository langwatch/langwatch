/**
 * Which rules the settings page lists, and which scopes it offers, for each built-in role.
 * Spec: specs/data-privacy/policy-configuration.feature
 */
import {
  builtinRoleGrants,
  type AuthzApi,
  type AuthzCanBatchByIdsInput,
} from "@langwatch/authz-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  resolveDataPrivacy,
  type DataPrivacyPolicy,
} from "@langwatch/data-privacy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { DataPrivacyDirectoryReader } from "../../app/data-privacy.app.ts";
import { DataPrivacyPermissionsService } from "../data-privacy-permissions.service.ts";
import { DataPrivacySnapshotService } from "../data-privacy-snapshot.service.ts";

const directory: DataPrivacyDirectoryReader = {
  findProjectLineage: async () => ({
    projectId: "web-app",
    name: "Web app",
    teamId: "team-1",
    organizationId: "org-1",
    organizationName: "Org",
  }),
  findOrganizationDirectory: async () => ({
    departments: [],
    teams: [{ id: "team-1", name: "Platform" }],
    projects: [{ id: "web-app", name: "Web app", teamId: "team-1" }],
    groups: [],
  }),
  findScopeOrganizationId: async () => "org-1",
};

const adminsOnlyProjectRule: DataPrivacyPolicy = {
  id: "rule-1",
  organizationId: "org-1",
  scopeType: "PROJECT",
  scopeId: "web-app",
  personalOnly: false,
  config: { categories: { input: { disposition: "restrict", audience: { admins: true } } } },
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const effective = resolveDataPrivacy({
  rows: [adminsOnlyProjectRule],
  facts: {
    organizationId: "org-1",
    teamId: "team-1",
    projectId: "web-app",
    departmentId: null,
    isPersonal: false,
  },
});

/** The snapshot as a holder of one built-in role on the team and project sees it. */
function snapshotAs(role: "admin" | "member") {
  const grants = (permission: string) => builtinRoleGrants({ role, permission });
  const authz = createApiFixture<AuthzApi>({
    hasPermission: async ({ permission }) => grants(permission),
    canBatchByIds: async (input: AuthzCanBatchByIdsInput) => ({
      teams: new Map(input.teams.map((team) => [team.teamId, grants(input.permission)])),
      projects: new Map(
        input.projects.map((project) => [project.projectId, grants(input.permission)]),
      ),
      organizationRole: null,
    }),
  });
  return DataPrivacySnapshotService.create({
    policies: {
      getResolvedForProject: async () => effective,
      listOrganizationRules: async () => [adminsOnlyProjectRule],
    },
    directory,
    permissions: DataPrivacyPermissionsService.create({ authz }),
  }).getSnapshot({ userId: "user-1", projectId: "web-app" });
}

describe("given an Admins-only rule on project web-app", () => {
  describe("when a project Member opens Settings > Data Privacy", () => {
    /** @scenario "A project Member sees the policy that applies but not the project rule to edit" */
    it("lists no project rule and offers no project to write one at", async () => {
      const snapshot = await snapshotAs("member");

      expect(snapshot.rules).toEqual([]);
      expect(snapshot.available.projects).toEqual([]);
    });

    it("still shows them the policy in force on the project", async () => {
      const snapshot = await snapshotAs("member");

      expect(snapshot.effective.categories.input).toEqual({
        disposition: "restrict",
        audience: { ...PLATFORM_DEFAULT_DATA_PRIVACY.categories.input.audience, admins: true },
      });
    });
  });

  describe("when a project Admin opens it", () => {
    /** @scenario "A project Member sees the policy that applies but not the project rule to edit" */
    it("lists the project rule and offers the project to write at", async () => {
      const snapshot = await snapshotAs("admin");

      expect(snapshot.rules.map((rule) => [rule.scopeType, rule.scopeId])).toEqual([
        ["PROJECT", "web-app"],
      ]);
      expect(snapshot.available.projects.map((project) => project.id)).toEqual(["web-app"]);
    });
  });
});
