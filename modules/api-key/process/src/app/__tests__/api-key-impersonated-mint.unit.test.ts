import { PermissionDeniedError } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
/**
 * No API key is minted while an operator acts as another member (F05).
 *
 * @see modules/api-key/specs/api-key.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "organization-1";

async function appOver() {
  const apiKeys = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const hasPermission = vi.fn<AuthzApi["hasPermission"]>(async () => false);
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: { apiKeys, answers: MemoryApiKeyAnswerCacheRepository.create() },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({ hasPermission }),
      organizations: createApiFixture<OrganizationApi>({}),
      projects: createApiFixture<ProjectApi>({}),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });

  return { app, hasPermission };
}

const request: Parameters<ApiKeyModule["createKey"]>[0] = {
  organizationId: ORG_ID,
  name: "Key",
  keyType: "personal",
  permissionMode: "all",
  bindings: [{ role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
};

describe("given an operator acting as a member", () => {
  /** @scenario "No API key is minted while an operator acts as another member" */
  it("refuses the mint with permission_denied before any check or write", async () => {
    const { app, hasPermission } = await appOver();

    for (const keyType of ["personal", "service"] as const) {
      const minting = app.createKey(
        { ...request, keyType },
        { id: "member-1", impersonatorId: "operator-1" },
      );
      await expect(minting).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(minting).rejects.toMatchObject({ code: "permission_denied" });
    }
    expect(hasPermission).not.toHaveBeenCalled();
  });
});

describe("given a member acting as themselves", () => {
  /** @scenario "A member acting as themselves still mints API keys" */
  it("is not refused as an impersonated mint and reaches the membership check", async () => {
    const { app, hasPermission } = await appOver();

    await expect(app.createKey(request, { id: "member-1" })).rejects.not.toBeInstanceOf(
      PermissionDeniedError,
    );
    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ userId: "member-1" }));
  });
});
