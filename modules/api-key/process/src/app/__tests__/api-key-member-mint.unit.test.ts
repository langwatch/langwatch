import { ApiKeyScopeViolationError } from "@langwatch/api-key-contract";
import { permissionsConferred, type AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
/**
 * What a member may mint, over the memory twins; the authz double answers
 * the ceiling from the role tables the engine reads.
 * @see specs/api-keys/api-keys-v2.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "acme";
const ALPHA = "alpha";
const BETA = "beta";

type Held = { role: "ADMIN" | "MEMBER" | "VIEWER"; scopeId: string };

const HELD: Record<string, Held> = {
  max: { role: "MEMBER", scopeId: ALPHA },
  vic: { role: "VIEWER", scopeId: ALPHA },
};

function permissionsHeld({ userId, scopeId }: { userId: string; scopeId: string }): string[] {
  const held = HELD[userId];
  if (!held || held.scopeId !== scopeId) return [];
  return [
    ...permissionsConferred({ role: held.role, scopeType: "PROJECT", customPermissions: [] }),
  ];
}

async function appOver() {
  const database = MemoryApiKeyDatabase.create();
  const apiKeys = MemoryApiKeyRepository.create({ memory: database });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const attachBindings = vi.fn<AuthzApi["attachBindings"]>(async ({ bindings }) => ({
    attached: bindings.map((binding) => binding.bindingId),
    duplicates: [],
  }));
  const app = await ApiKeyModule.create({
    repositories: { apiKeys, answers: MemoryApiKeyAnswerCacheRepository.create() },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({
        hasPermission: vi.fn(async () => true),
        findPermissionsBeyondCaller: vi.fn<AuthzApi["findPermissionsBeyondCaller"]>(
          async ({ caller, scope, permissions }) => {
            const held = permissionsHeld({
              userId: caller.type === "user" ? (caller.id ?? "") : "",
              scopeId: scope.id,
            });
            return permissions.filter((permission) => !held.includes(permission));
          },
        ),
        attachBindings,
        revokeBindingsWhere: vi.fn(async () => 0),
        listApiKeyBindings: vi.fn(async ({ apiKeyIds }) =>
          attachBindings.mock.calls.flatMap(([call]) =>
            call.bindings.map((binding) => ({
              id: binding.bindingId,
              apiKeyId: apiKeyIds[0] as string,
              role: binding.role,
              scopeType: binding.scopeType,
              scopeId: binding.scopeId,
              customRoleId: null,
              expiresAt: null,
            })),
          ),
        ) as never,
      }),
      organizations: createApiFixture<OrganizationApi>({}),
      projects: createApiFixture<ProjectApi>({
        getWithTeam: vi.fn(async () => ({
          archivedAt: null,
          team: { id: "core", organizationId: ORG_ID },
        })) as never,
        findPersonalWorkspaceOwner: vi.fn(async () => null),
      }),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });

  return { app, rows: () => database.keys() };
}

function personalKey({
  role,
  projectId,
}: {
  role: "ADMIN" | "MEMBER";
  projectId: string;
}): Parameters<ApiKeyModule["createKey"]>[0] {
  return {
    organizationId: ORG_ID,
    name: "personal",
    keyType: "personal",
    permissionMode: "all",
    bindings: [{ role, scopeType: "PROJECT", scopeId: projectId }],
  };
}

describe("given a member who holds the Member role on one project", () => {
  describe("when they mint a personal key with the Member role there", () => {
    /** @scenario "A member mints a personal key within their own grants" */
    it("mints it, owned by them, and answers its token", async () => {
      const { app, rows } = await appOver();

      const minted = await app.createKey(personalKey({ role: "MEMBER", projectId: ALPHA }), {
        id: "max",
      });

      expect(minted.token).toMatch(/^sk-lw-/);
      expect(minted.assignedToUserId).toBe("max");
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toMatchObject({ userId: "max", revokedAt: null });
    });
  });

  describe("when they mint a personal key on a project they do not hold", () => {
    /** @scenario "A member cannot mint a key on a project they do not hold" */
    it("is refused with 403 and writes no key row", async () => {
      const { app, rows } = await appOver();

      const minting = app.createKey(personalKey({ role: "MEMBER", projectId: BETA }), {
        id: "max",
      });

      await expect(minting).rejects.toMatchObject({
        code: "api_key_scope_violation",
        httpStatus: 403,
      });
      expect(rows()).toHaveLength(0);
    });
  });
});

describe("given a member who holds only the Viewer role on a project", () => {
  describe("when they mint a personal key with the Admin role there", () => {
    /** @scenario "A member cannot mint a key with a role above their own" */
    it("is refused with 403 naming the permissions beyond theirs, and writes no key row", async () => {
      const { app, rows } = await appOver();
      const beyond = permissionsConferred({
        role: "ADMIN",
        scopeType: "PROJECT",
        customPermissions: [],
      }).filter(
        (permission) => !permissionsHeld({ userId: "vic", scopeId: ALPHA }).includes(permission),
      );

      const failure = await app
        .createKey(personalKey({ role: "ADMIN", projectId: ALPHA }), { id: "vic" })
        .then(
          () => null,
          (error: unknown) => error,
        );

      expect(failure).toBeInstanceOf(ApiKeyScopeViolationError);
      expect(failure).toMatchObject({ code: "api_key_scope_violation", httpStatus: 403 });
      expect(beyond.length).toBeGreaterThan(0);
      for (const permission of beyond) {
        expect((failure as Error).message).toContain(permission);
      }
      expect(rows()).toHaveLength(0);
    });
  });
});
