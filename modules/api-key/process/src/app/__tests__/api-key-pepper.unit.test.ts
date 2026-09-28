/**
 * The pepper chain main hashed every key under: API_KEY_PEPPER, else CREDENTIALS_SECRET, else
 * NEXTAUTH_SECRET, refusing the boot when none is set (Alex, 2026-09-28).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { API_KEY_PREFIX } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { hashApiKeySecret } from "../../rules/api-key-token.rules.ts";
import { ApiKeyApp } from "../api-key.app.ts";

const LOOKUP_ID = "LocalDevPrivate1";
const SECRET = "LocalDevPrivateAccessTokenSecretFixedValue000000";
const TOKEN = `${API_KEY_PREFIX}${LOOKUP_ID}_${SECRET}`;

/** The app built for real over its memory twin, its secrets scoped as boot scopes them. */
async function appOver({
  environment,
  hashedUnder,
}: {
  environment: Readonly<Record<string, string>>;
  hashedUnder: string;
}): Promise<ApiKeyApp> {
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
    roleBindings: [],
  });
  const resolver = SecretsResolver.over(SecretsChain.start({ environment }).withEnv());

  return ApiKeyApp.create({
    repositories: { apiKeys },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({
        listApiKeyBindings: async () => [],
        deriveGrantId: () => "grant-1",
        findEngineCutoverAt: async () => null,
      }),
      organizations: createApiFixture<OrganizationApi>({}),
      projects: createApiFixture<ProjectApi>({}),
    },
    members: {
      redis: null,
      encryption: { encrypt: (plaintext) => plaintext, decrypt: (ciphertext) => ciphertext },
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyApp.secrets)),
  });
}

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

  describe("when none of the chain is set", () => {
    it("refuses to build, naming the secrets it looked for", async () => {
      const refused = appOver({ environment: { API_KEY_PEPPER: "" }, hashedUnder: "" });

      await expect(refused).rejects.toMatchObject({ code: "config_refused" });
      await expect(refused).rejects.toThrow(/API_KEY_PEPPER/);
    });
  });
});
