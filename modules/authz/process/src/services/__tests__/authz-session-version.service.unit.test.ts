import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  ROLE_DEFINED_EVENT_TYPE,
  ROLE_DELETED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  type AuthzGrantEventPayload,
} from "@langwatch/authz-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { StubAuthzManagedGrantRepository } from "../../repositories/__tests__/support/authz-managed-grant.stub.ts";
import type { AuthzGrantPrincipalRow } from "../../repositories/authz-managed-grant.repository.ts";
import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzManagedGrantRepository } from "../../repositories/memory/memory.authz-managed-grant.repository.ts";
import { MemoryAuthzSessionVersionRepository } from "../../repositories/memory/memory.authz-session-version.repository.ts";
import { AuthzSessionVersionService } from "../authz-session-version.service.ts";

const ORG = "org_acme";
const ACTOR = { type: "user", id: "user_admin" } satisfies AuthzGrantEventPayload["data"]["actor"];
const GROUP = { id: "group_eng", name: "Engineering", slug: "eng", scimSource: null };
const EVERYONE = ["user_ada", "user_bo", "user_cy"];
const ROLE_EDITED: AuthzGrantEventPayload = {
  type: ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  data: { roleId: "role_custom", permissions: ["traces:view"], actor: ACTOR },
};

function attached(principal: {
  type: "user" | "group" | "apiKey";
  id: string;
}): AuthzGrantEventPayload {
  return {
    type: GRANT_ATTACHED_EVENT_TYPE,
    data: {
      grantId: `grant_${principal.id}`,
      principal,
      roleKey: "member",
      scope: { type: "ORGANIZATION", id: ORG },
      source: "grants-service",
      actor: ACTOR,
    },
  };
}

describe("AuthzSessionVersionService", () => {
  let memory: AuthzMemoryStore;
  let service: AuthzSessionVersionService;

  const versionOf = (userId: string) => service.getSessionVersion({ userId });

  beforeEach(() => {
    memory = AuthzMemoryStore.create();
    service = AuthzSessionVersionService.create({
      versions: MemoryAuthzSessionVersionRepository.create({ memory }),
      bindings: MemoryAuthzManagedGrantRepository.create({ memory }),
    });
    for (const userId of ["user_ada", "user_bo", "user_cy"]) {
      memory.memberships.set(`${ORG}:${userId}`, {
        role: "MEMBER",
        disabled: false,
        membershipStamp: `stamp_${userId}`,
        pendingSsoGrantId: null,
        createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      });
    }
    memory.groups.push({ ...GROUP, organizationId: ORG });
    memory.groupMemberships.push(
      { userId: "user_bo", groupId: GROUP.id },
      { userId: "user_cy", groupId: GROUP.id },
    );
  });

  it("answers 0 for a user never bumped", async () => {
    await expect(versionOf("user_ada")).resolves.toBe(0);
  });

  describe("when a membership or role binding changes", () => {
    /** @scenario "A membership or role binding change bumps the version" */
    it("bumps the user a grant attaches to, and no one else", async () => {
      await service.bumpFor({
        organizationId: ORG,
        event: attached({ type: "user", id: "user_ada" }),
      });

      await expect(versionOf("user_ada")).resolves.toBe(1);
      await expect(versionOf("user_bo")).resolves.toBe(0);
    });

    it("bumps every member of a group the grant attaches to", async () => {
      await service.bumpFor({
        organizationId: ORG,
        event: attached({ type: "group", id: GROUP.id }),
      });

      await expect(versionOf("user_ada")).resolves.toBe(0);
      await expect(versionOf("user_bo")).resolves.toBe(1);
      await expect(versionOf("user_cy")).resolves.toBe(1);
    });

    /** @scenario A binding or unbinding refreshes exactly the users it reaches */
    it("bumps the members of a team the grant attaches to", async () => {
      memory.teams.push({
        id: "team_core",
        organizationId: ORG,
        name: "Core",
        isPersonal: false,
        ownerUserId: null,
      });
      memory.teamMemberships.push({
        teamId: "team_core",
        userId: "user_cy",
        role: "MEMBER",
        assignedRoleId: null,
        createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      });

      await service.bumpFor({
        organizationId: ORG,
        event: {
          type: GRANT_ATTACHED_EVENT_TYPE,
          data: {
            grantId: "grant_team_core",
            principal: { type: "team", id: "team_core" },
            roleKey: "member",
            scope: { type: "ORGANIZATION", id: ORG },
            source: "grants-service",
            actor: ACTOR,
          },
        },
      });

      await expect(versionOf("user_cy")).resolves.toBe(1);
      await expect(versionOf("user_ada")).resolves.toBe(0);
      await expect(versionOf("user_bo")).resolves.toBe(0);
    });

    it("bumps a removed member through the revoked grant's own principal", async () => {
      memory.bindings.push({
        id: "grant_gone",
        organizationId: ORG,
        userId: "user_gone",
        groupId: null,
        apiKeyId: null,
        role: "MEMBER",
        customRoleId: null,
        scopeType: "ORGANIZATION",
        scopeId: ORG,
        createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      });

      await service.bumpFor({
        organizationId: ORG,
        event: { type: GRANT_REVOKED_EVENT_TYPE, data: { grantId: "grant_gone", actor: ACTOR } },
      });

      await expect(versionOf("user_gone")).resolves.toBe(1);
      await expect(versionOf("user_ada")).resolves.toBe(0);
    });

    /** @scenario A binding or unbinding refreshes exactly the users it reaches */
    it("bumps a group's members when its grant is revoked", async () => {
      memory.bindings.push({
        id: "grant_eng",
        organizationId: ORG,
        userId: null,
        groupId: GROUP.id,
        apiKeyId: null,
        role: "MEMBER",
        customRoleId: null,
        scopeType: "ORGANIZATION",
        scopeId: ORG,
        createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      });

      await service.bumpFor({
        organizationId: ORG,
        event: { type: GRANT_REVOKED_EVENT_TYPE, data: { grantId: "grant_eng", actor: ACTOR } },
      });

      await expect(Promise.all(EVERYONE.map(versionOf))).resolves.toEqual([0, 1, 1]);
    });

    /** @scenario A binding or unbinding refreshes exactly the users it reaches */
    it("bumps only the grant's own user when the grant changes role", async () => {
      memory.bindings.push({
        id: "grant_ada",
        organizationId: ORG,
        userId: "user_ada",
        groupId: null,
        apiKeyId: null,
        role: "MEMBER",
        customRoleId: null,
        scopeType: "ORGANIZATION",
        scopeId: ORG,
        createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      });

      await service.bumpFor({
        organizationId: ORG,
        event: {
          type: GRANT_ROLE_CHANGED_EVENT_TYPE,
          data: { grantId: "grant_ada", from: "member", to: "admin", actor: ACTOR },
        },
      });

      await expect(Promise.all(EVERYONE.map(versionOf))).resolves.toEqual([1, 0, 0]);
    });

    it("bumps no one for an API key's grant, which no browser session reads", async () => {
      await service.bumpFor({
        organizationId: ORG,
        event: attached({ type: "apiKey", id: "key_1" }),
      });

      for (const userId of ["user_ada", "user_bo", "user_cy"]) {
        await expect(versionOf(userId)).resolves.toBe(0);
      }
    });
  });

  describe("when a role's permissions change or it is deleted", () => {
    let bindings: StubAuthzManagedGrantRepository;
    let lines: ReturnType<typeof createTestLogger>["lines"];

    beforeEach(() => {
      bindings = new StubAuthzManagedGrantRepository();
      bindings.findOrganizationUserIds.mockResolvedValue(EVERYONE);
      const testLogger = createTestLogger();
      lines = testLogger.lines;
      service = AuthzSessionVersionService.create({
        versions: MemoryAuthzSessionVersionRepository.create({ memory }),
        bindings,
        logger: testLogger.logger,
      });
    });

    const versionsOfEveryone = () => Promise.all(EVERYONE.map(versionOf));

    /** @scenario Editing a role refreshes only its holders' sessions */
    it("bumps the users bound to the role directly, and no one else", async () => {
      bindings.findRoleHolderPrincipals.mockResolvedValue([
        { type: "user", id: "user_ada" },
        { type: "apiKey", id: "key_1" },
      ]);

      await service.bumpFor({ organizationId: ORG, event: ROLE_EDITED });

      await expect(versionsOfEveryone()).resolves.toEqual([1, 0, 0]);
      expect(bindings.findOrganizationUserIds).not.toHaveBeenCalled();
    });

    /** @scenario Editing a role refreshes only its holders' sessions */
    it("bumps the members of a group bound to the role", async () => {
      bindings.findRoleHolderPrincipals.mockResolvedValue([{ type: "group", id: GROUP.id }]);
      bindings.findGroupMembers.mockImplementation(async ({ groupIds }) =>
        groupIds.includes(GROUP.id) ? [{ groupId: GROUP.id, userId: "user_bo" }] : [],
      );

      await service.bumpFor({ organizationId: ORG, event: ROLE_EDITED });

      await expect(versionsOfEveryone()).resolves.toEqual([0, 1, 0]);
    });

    /** @scenario Editing a role refreshes only its holders' sessions */
    it("bumps the members of a team bound to the role", async () => {
      bindings.findRoleHolderPrincipals.mockResolvedValue([{ type: "team", id: "team_core" }]);
      bindings.findTeamMembers.mockImplementation(async ({ teamIds }) =>
        teamIds.includes("team_core") ? [{ teamId: "team_core", userId: "user_cy" }] : [],
      );

      await service.bumpFor({ organizationId: ORG, event: ROLE_EDITED });

      await expect(versionsOfEveryone()).resolves.toEqual([0, 0, 1]);
    });

    /** @scenario Deleting a role refreshes only its holders' sessions */
    it("bumps a deleted role's holders the same way", async () => {
      bindings.findRoleHolderPrincipals.mockResolvedValue([{ type: "user", id: "user_bo" }]);

      await service.bumpFor({
        organizationId: ORG,
        event: { type: ROLE_DELETED_EVENT_TYPE, data: { roleId: "role_custom", actor: ACTOR } },
      });

      await expect(versionsOfEveryone()).resolves.toEqual([0, 1, 0]);
    });

    /** @scenario A role whose holders cannot be found refreshes the whole organization */
    it("bumps every organization member when the holder lookup fails", async () => {
      bindings.findRoleHolderPrincipals.mockRejectedValue(new Error("database unavailable"));

      await service.bumpFor({ organizationId: ORG, event: ROLE_EDITED });

      await expect(versionsOfEveryone()).resolves.toEqual([1, 1, 1]);
      expect(lines.findLine("warn", "bumping the whole organization")).toMatchObject({
        organizationId: ORG,
        roleId: "role_custom",
        errorClass: "Error",
      });
    });

    /** @scenario Editing a role refreshes only its holders' sessions */
    it("bumps a user, a group's members and a team's members bound to one role together", async () => {
      bindings.findRoleHolderPrincipals.mockResolvedValue([
        { type: "user", id: "user_ada" },
        { type: "group", id: GROUP.id },
        { type: "team", id: "team_core" },
      ]);
      bindings.findGroupMembers.mockResolvedValue([{ groupId: GROUP.id, userId: "user_bo" }]);
      bindings.findTeamMembers.mockResolvedValue([{ teamId: "team_core", userId: "user_cy" }]);

      await service.bumpFor({ organizationId: ORG, event: ROLE_EDITED });

      await expect(versionsOfEveryone()).resolves.toEqual([1, 1, 1]);
      expect(bindings.findOrganizationUserIds).not.toHaveBeenCalled();
    });

    /** @scenario A role whose holders cannot be found refreshes the whole organization */
    it("bumps every organization member when the role is bound to the organization itself", async () => {
      bindings.findRoleHolderPrincipals.mockResolvedValue([{ type: "organization", id: ORG }]);

      await service.bumpFor({ organizationId: ORG, event: ROLE_EDITED });

      await expect(versionsOfEveryone()).resolves.toEqual([1, 1, 1]);
    });

    /** @scenario A newly defined role refreshes no one */
    it("bumps no one when a role is defined, since nobody holds it yet", async () => {
      await service.bumpFor({
        organizationId: ORG,
        event: {
          type: ROLE_DEFINED_EVENT_TYPE,
          data: {
            roleId: "role_new",
            name: "Reviewer",
            permissions: ["traces:view"],
            kind: "custom",
            actor: ACTOR,
          },
        },
      });

      await expect(versionsOfEveryone()).resolves.toEqual([0, 0, 0]);
      expect(bindings.findOrganizationUserIds).not.toHaveBeenCalled();
    });

    /** @scenario A role whose holders cannot be found refreshes the whole organization */
    it("bumps every organization member when the role has too many holders to expand", async () => {
      bindings.findRoleHolderPrincipals.mockImplementation(async ({ limit }) => {
        const crowd: AuthzGrantPrincipalRow["principal"][] = Array.from(
          { length: limit },
          (_, index) => ({ type: "group", id: `group_${index}` }),
        );
        return crowd;
      });

      await service.bumpFor({ organizationId: ORG, event: ROLE_EDITED });

      await expect(versionsOfEveryone()).resolves.toEqual([1, 1, 1]);
      expect(bindings.findGroupMembers).not.toHaveBeenCalled();
    });
  });
});
