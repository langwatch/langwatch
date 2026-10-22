// Spec: modules/auth/specs/provider-tokens.feature
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EventSourcing } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores, resolvedSecrets } from "@langwatch/process-stores";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isDeclaredMigrationStep, isMigrationStep } from "@langwatch/upgrade/step";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { NO_SIGN_IN_PROVIDERS } from "../../app/__tests__/support/sign-in-providers.ts";
import { authProcessModule } from "../../auth.module.ts";
import { MemoryAuthMigrationRepository } from "../../repositories/memory/memory.auth-migration.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";

const STEP = "auth:discard-provider-tokens";

/** The installed auth module on a worker, over memory rows, with every peer refused by name. */
async function bootAuthWorker() {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }));
  return createApp({
    role: "worker",
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
  })
    .withModules([authProcessModule])
    .withStores(memoryStores())
    .withEncryption({ encrypt: (value: string) => value, decrypt: (value: string) => value })
    .withSecrets(resolvedSecrets({}))
    .withConfig({
      auth: {
        sessionUrl: undefined,
        mfaEnrollmentOpen: false,
        passkeysEnabled: false,
        passkeyHandleSecret: undefined,
        trustedIdpOrigins: undefined,
        idpSimulatorUrl: undefined,
        localPasswords: false,
        socialProviderBases: {
          google: undefined,
          github: undefined,
          gitlab: undefined,
          microsoft: undefined,
        },
        cliRefreshTokenTtlSeconds: undefined,
        isSaas: false,
        signInProviders: NO_SIGN_IN_PROVIDERS,
        signUpMode: "open",
        publicBaseUrl: "https://app.acme.test",
        nodeEnvironment: "test",
      },
    })
    .withEventing(new EventSourcing({ enabled: false, processManagerMode: "producer-only" }))
    .provide({
      user: createApiFixture<UserApi>(),
      "api-key": createApiFixture<ApiKeyApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      identity: createApiFixture<IdentityApi>({
        createStorageAdapter: ({ legacyEngine }) => legacyEngine,
      }),
      organization: createApiFixture<OrganizationApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      notification: createApiFixture<NotificationService>(),
      sso: createApiFixture<SsoApi>(),
      authz: createApiFixture<AuthzApi>(),
      project: createApiFixture<ProjectApi>(),
    })
    .boot();
}

/** Better Auth's memory rows under the channel's column names, tokens as each row holds them. */
function accountsHolding(rows: { id: string; tokens: boolean }[]): MemoryAuthDatabase {
  const memory = MemoryAuthDatabase.create();
  for (const { id, tokens } of rows) {
    memory.db.Account.push({
      id,
      userId: `user-${id}`,
      provider: "github",
      providerAccountId: `gh-${id}`,
      scope: "read:user,user:email",
      access_token: tokens ? `access-${id}` : null,
      refresh_token: tokens ? `refresh-${id}` : null,
      id_token: tokens ? `id-${id}` : null,
    });
  }
  return memory;
}

function tokensOf(memory: MemoryAuthDatabase) {
  return memory.db.Account.map(({ access_token, refresh_token, id_token }) => ({
    access_token,
    refresh_token,
    id_token,
  }));
}

describe("auth's provider token discard step", () => {
  /** @scenario "The token discard step is a background step that waits for old writers to go" */
  it("is a background step that needs old writers gone", async () => {
    const runtime = await bootAuthWorker();
    try {
      const step = runtime
        .migrationSteps(isDeclaredMigrationStep)
        .filter(isMigrationStep)
        .find((candidate) => candidate.id === STEP);

      expect(step).toMatchObject({ kind: "data", mode: "background", needsOldWritersGone: true });
    } finally {
      await runtime.stop();
    }
  });

  describe("given two accounts holding provider tokens and one holding none", () => {
    /** @scenario "The token discard step clears every account's tokens once" */
    it("clears both on a run, nothing on a dry run, and nothing on a second run", async () => {
      const memory = accountsHolding([
        { id: "a", tokens: true },
        { id: "b", tokens: true },
        { id: "c", tokens: false },
      ]);
      const repository = MemoryAuthMigrationRepository.create({ memory });
      const before = tokensOf(memory);

      expect(await repository.discardProviderTokens({ dryRun: true })).toBe(2);
      expect(tokensOf(memory)).toEqual(before);

      expect(await repository.discardProviderTokens({ dryRun: false })).toBe(2);
      expect(tokensOf(memory)).toEqual(
        Array.from({ length: 3 }, () => ({
          access_token: null,
          refresh_token: null,
          id_token: null,
        })),
      );
      expect(memory.db.Account.map(({ scope }) => scope)).toEqual([
        "read:user,user:email",
        "read:user,user:email",
        "read:user,user:email",
      ]);

      expect(await repository.discardProviderTokens({ dryRun: false })).toBe(0);
    });
  });
});
