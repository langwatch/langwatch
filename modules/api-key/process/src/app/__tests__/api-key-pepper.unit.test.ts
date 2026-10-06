import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
/**
 * The pepper chain main hashed every key under: API_KEY_PEPPER, else CREDENTIALS_SECRET, else
 * NEXTAUTH_SECRET, refusing the boot when none is set (Alex, 2026-09-28).
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryAgentSandboxKeyRepository } from "../../repositories/memory/memory.agent-sandbox-key.repository.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { hashApiKeySecret } from "../../rules/api-key-token.rules.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const LOOKUP_ID = "LocalDevPrivate1";
const SECRET = "LocalDevPrivateAccessTokenSecretFixedValue000000";
const TOKEN = `${API_KEY_PREFIX}${LOOKUP_ID}_${SECRET}`;

/** The app built for real over its memory twin, its secrets scoped as boot scopes them. */
async function appOver(input: {
  environment: Readonly<Record<string, string>>;
  hashedUnder: string;
}): Promise<ApiKeyModule> {
  return (await appAndKeysOver(input)).app;
}

/** The same app, with the repository it reads, for a test that checks what a use wrote back. */
async function appAndKeysOver({
  environment,
  hashedUnder,
}: {
  environment: Readonly<Record<string, string>>;
  hashedUnder: string;
}): Promise<{ app: ApiKeyModule; apiKeys: MemoryApiKeyRepository }> {
  const memory = MemoryApiKeyDatabase.create();
  const apiKeys = MemoryApiKeyRepository.create({ memory });
  await apiKeys.create({
    name: "Local Dev Private Access Token",
    description: null,
    lookupId: LOOKUP_ID,
    hashedSecret: hashApiKeySecret({ secret: SECRET, pepper: hashedUnder }),
    permissionMode: "all",
    userId: null,
    createdByUserId: null,
    organizationId: "organization-1",
    expiresAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    startsDisabled: false,
    grants: [],
  });
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());

  const app = await ApiKeyModule.create({
    repositories: {
      apiKeys,
      answers: MemoryApiKeyAnswerCacheRepository.create(),
      sandboxKeys: MemoryAgentSandboxKeyRepository.create(),
    },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({
        listApiKeyBindings: async () => [],
        deriveGrantId: () => "grant-1",
        findEngineCutoverAt: async () => null,
      }),
      organizations: createApiFixture<OrganizationApi>({}),
      projects: createApiFixture<ProjectApi>({}),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });

  return { app, apiKeys };
}

describe("given a key hashed under the credentials secret a rotation retired", () => {
  describe("when the old secret is set as CREDENTIALS_SECRET_PREVIOUS", () => {
    /** @scenario "An API key issued before the rotation keeps working and moves to the new secret on use" */
    it("accepts the key and rewrites its hash under the new secret", async () => {
      const { app, apiKeys } = await appAndKeysOver({
        environment: {
          CREDENTIALS_SECRET: "new-secret",
          CREDENTIALS_SECRET_PREVIOUS: "old-secret",
        },
        hashedUnder: "old-secret",
      });

      await expect(app.findVerifiedToken({ token: TOKEN })).resolves.toMatchObject({
        name: "Local Dev Private Access Token",
      });
      await vi.waitFor(async () => {
        const stored = await apiKeys.findByLookupId({ lookupId: LOOKUP_ID });
        expect(stored?.hashedSecret).toBe(
          hashApiKeySecret({ secret: SECRET, pepper: "new-secret" }),
        );
      });
    });
  });

  describe("when the previous secret has been removed", () => {
    /** @scenario "An API key issued before the rotation is refused once the previous secret is removed" */
    it("refuses the key", async () => {
      const app = await appOver({
        environment: { CREDENTIALS_SECRET: "new-secret" },
        hashedUnder: "old-secret",
      });

      await expect(app.findVerifiedToken({ token: TOKEN })).resolves.toBeNull();
    });
  });

  describe("when API_KEY_PEPPER is set", () => {
    /** @scenario "A dedicated API key pepper keeps API keys out of the rotation" */
    it("ignores the previous credentials secret, so a hash under it is refused", async () => {
      const app = await appOver({
        environment: {
          API_KEY_PEPPER: "dedicated-pepper",
          CREDENTIALS_SECRET: "new-secret",
          CREDENTIALS_SECRET_PREVIOUS: "old-secret",
        },
        hashedUnder: "old-secret",
      });

      await expect(app.findVerifiedToken({ token: TOKEN })).resolves.toBeNull();
    });
  });
});

describe("given a key main hashed under the deployment's credentials secret", () => {
  describe("when only CREDENTIALS_SECRET is set", () => {
    it("still verifies the key", async () => {
      const app = await appOver({
        environment: { CREDENTIALS_SECRET: "old-secret", NEXTAUTH_SECRET: "session-secret" },
        hashedUnder: "old-secret",
      });

      await expect(app.findVerifiedToken({ token: TOKEN })).resolves.toMatchObject({
        name: "Local Dev Private Access Token",
      });
    });
  });

  describe("when only NEXTAUTH_SECRET is set", () => {
    it("verifies a key hashed under it", async () => {
      const app = await appOver({
        environment: { NEXTAUTH_SECRET: "session-secret" },
        hashedUnder: "session-secret",
      });

      await expect(app.findVerifiedToken({ token: TOKEN })).resolves.not.toBeNull();
    });
  });

  describe("when API_KEY_PEPPER is set beside the fallbacks", () => {
    it("hashes under API_KEY_PEPPER, so the credentials-secret hash no longer matches", async () => {
      const app = await appOver({
        environment: { API_KEY_PEPPER: "dedicated-pepper", CREDENTIALS_SECRET: "old-secret" },
        hashedUnder: "old-secret",
      });

      await expect(app.findVerifiedToken({ token: TOKEN })).resolves.toBeNull();
    });
  });

  describe("when API_KEY_PEPPER is set", () => {
    /** @scenario The API-key pepper reaches the service verbatim */
    it("verifies a key hashed under that exact value, not one derived from it", async () => {
      const app = await appOver({
        environment: { API_KEY_PEPPER: "dedicated-pepper" },
        hashedUnder: "dedicated-pepper",
      });

      await expect(app.findVerifiedToken({ token: TOKEN })).resolves.toMatchObject({
        name: "Local Dev Private Access Token",
      });
    });
  });

  describe("when none of the chain is set", () => {
    it("refuses to build, naming the secrets it looked for", async () => {
      const refused = appOver({ environment: { API_KEY_PEPPER: "" }, hashedUnder: "" });

      await expect(refused).rejects.toMatchObject({ code: "config_refused" });
      await expect(refused).rejects.toThrow(/API_KEY_PEPPER/);
    });
  });
});
