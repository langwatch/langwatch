import { ApiKeyAdminRequiredError } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
/**
 * The ceiling a restricted key's rows are drawn from: asked of the resolver the mint checks
 * with, for the caller, or for another owner only when an organization admin asks.
 * Refs langwatch/tasks#1107.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "organization-1";
const MEMBER = { id: "member-1" };
const PROJECT = { scopeType: "PROJECT" as const, scopeId: "project-1" };

async function appOver({ held }: { held: string[] }) {
  const askedFor: unknown[] = [];
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: {
      apiKeys: MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
      answers: MemoryApiKeyAnswerCacheRepository.create(),
      sandboxKeys: MemorySharedCredentialStore.create(),
      runKeys: MemorySharedCredentialStore.create(),
    },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({
        hasPermission: vi.fn(async () => true),
        // No direct binding: whatever the member holds reaches them through a group.
        listUserBindings: vi.fn(async () => []),
        findPermissionsBeyondCaller: vi.fn(async ({ caller, permissions }) => {
          askedFor.push(caller);
          return permissions.filter((permission: string) => !held.includes(permission));
        }),
      }),
      organizations: createApiFixture<OrganizationApi>({}),
      projects: createApiFixture<ProjectApi>({
        getWithTeam: vi.fn(async () => ({
          archivedAt: null,
          kind: "application",
          team: { id: "team-1", organizationId: ORG_ID },
        })) as never,
      }),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });

  return { app, askedFor };
}

describe("given a member who reaches the project only through a group", () => {
  describe("when they ask what their own restricted key may carry", () => {
    it("answers what the resolver holds for them there", async () => {
      const { app, askedFor } = await appOver({ held: ["traces:view", "annotations:view"] });

      const offered = await app.listGrantablePermissions(
        { organizationId: ORG_ID, scopes: [PROJECT] },
        MEMBER,
      );

      expect(offered.toSorted()).toEqual(["annotations:view", "traces:view"]);
      expect(askedFor).toEqual([{ type: "user", id: MEMBER.id }]);
    });
  });

  describe("when they ask about a key for someone else", () => {
    it("refuses, since only an organization admin assigns keys", async () => {
      const { app } = await appOver({ held: ["traces:view"] });

      await expect(
        app.listGrantablePermissions(
          { organizationId: ORG_ID, scopes: [PROJECT], ownerUserId: "someone-else" },
          MEMBER,
        ),
      ).rejects.toBeInstanceOf(ApiKeyAdminRequiredError);
    });
  });
});
