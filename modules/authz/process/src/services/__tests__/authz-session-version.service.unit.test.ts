import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
  type AuthzGrantEventPayload,
} from "@langwatch/authz-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { AuthzMemoryStore } from "../../repositories/memory/authz-memory.store.ts";
import { MemoryAuthzManagedGrantRepository } from "../../repositories/memory/memory.authz-managed-grant.repository.ts";
import { MemoryAuthzSessionVersionRepository } from "../../repositories/memory/memory.authz-session-version.repository.ts";
import { AuthzSessionVersionService } from "../authz-session-version.service.ts";

const ORG = "org_acme";
const ACTOR = { type: "user", id: "user_admin" } satisfies AuthzGrantEventPayload["data"]["actor"];
const GROUP = { id: "group_eng", name: "Engineering", slug: "eng", scimSource: null };

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
      memory.organizationRoles.set(`${ORG}:${userId}`, "MEMBER");
    }
    memory.groupMemberships.push(
      { organizationId: ORG, userId: "user_bo", groupId: GROUP.id, group: GROUP },
      { organizationId: ORG, userId: "user_cy", groupId: GROUP.id, group: GROUP },
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

    it("bumps every organization member when a role's permissions change", async () => {
      await service.bumpFor({
        organizationId: ORG,
        event: {
          type: ROLE_PERMISSIONS_CHANGED_EVENT_TYPE,
          data: { roleId: "role_custom", permissions: ["traces:view"], actor: ACTOR },
        },
      });

      for (const userId of ["user_ada", "user_bo", "user_cy"]) {
        await expect(versionOf(userId)).resolves.toBe(1);
      }
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
      });

      await service.bumpFor({
        organizationId: ORG,
        event: { type: GRANT_REVOKED_EVENT_TYPE, data: { grantId: "grant_gone", actor: ACTOR } },
      });

      await expect(versionOf("user_gone")).resolves.toBe(1);
      await expect(versionOf("user_ada")).resolves.toBe(0);
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
});
