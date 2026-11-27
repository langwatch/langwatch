import { ImpersonationCannotMintCredentialError } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
/**
 * No API key is minted while an operator acts as another member (F05).
 *
 * @see modules/api-key/specs/api-key.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyChannels } from "../../channels/memory/memory.api-key.channels.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "organization-1";

async function appOver() {
  const apiKeys = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const hasPermission = vi.fn<AuthzApi["hasPermission"]>(async () => false);
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: {
      apiKeys,
      answers: MemoryApiKeyAnswerCacheRepository.create(),
      sandboxKeys: MemorySharedCredentialStore.create(),
      runKeys: MemorySharedCredentialStore.create(),
      signingKeys: MemorySigningKeyRepository.create(),
      signingKeyUsage: MemorySigningKeyUsageRepository.create(),
    },
    channels: MemoryApiKeyChannels.create(),
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
  it("refuses the mint with impersonation_cannot_mint_credential before any check or write", async () => {
    const { app, hasPermission } = await appOver();

    for (const keyType of ["personal", "service"] as const) {
      const minting = app.createKey(
        { ...request, keyType },
        { id: "member-1", impersonatorId: "operator-1" },
      );
      await expect(minting).rejects.toBeInstanceOf(ImpersonationCannotMintCredentialError);
      await expect(minting).rejects.toMatchObject({ code: "impersonation_cannot_mint_credential" });
    }
    expect(hasPermission).not.toHaveBeenCalled();
  });
});

describe("given a member acting as themselves", () => {
  /** @scenario "A member acting as themselves still mints API keys" */
  it("is not refused as an impersonated mint and reaches the membership check", async () => {
    const { app, hasPermission } = await appOver();

    await expect(app.createKey(request, { id: "member-1" })).rejects.not.toBeInstanceOf(
      ImpersonationCannotMintCredentialError,
    );
    expect(hasPermission).toHaveBeenCalledWith(expect.objectContaining({ userId: "member-1" }));
  });
});
