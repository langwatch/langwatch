import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
/**
 * A signed-in caller's own confirmation link: refused without an address,
 * metered per caller, and mailed through sign-up's own link.
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";
import { TestUserApi } from "./support/test-user-api.ts";

/** The limiter member, over a memory counter, remembering the window each check named. */
function countingLimiter() {
  const counts = new Map<string, number>();
  const windows: ({ requests: number; seconds: number } | undefined)[] = [];

  const rateLimiter = {
    check: async (key: string, limit?: { requests: number; seconds: number }) => {
      windows.push(limit);
      const used = (counts.get(key) ?? 0) + 1;
      counts.set(key, used);
      const requests = limit?.requests ?? 1;

      return used <= requests ? { allowed: true } : { allowed: false, retryAfterSeconds: 60 };
    },
  };

  return { rateLimiter, windows };
}

async function appFor(
  limiter: ReturnType<typeof countingLimiter>["rateLimiter"],
): Promise<AuthApp> {
  return AuthApp.create({
    config: {
      sessionUrl: undefined,
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: undefined,
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: false,
    },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      users: new TestUserApi({}) as never,
      apiKeys: {
        findResolvedToken: async () => ({ project: { slug: "acme" } }),
      } as never,
      featureFlags: {} as never,
      identity: createApiFixture<IdentityApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      auditLog: createApiFixture<AuditLogApi>({ record: async () => {} }),
    },
    members: {
      encryption: { encrypt: (value: string) => value, decrypt: (value: string) => value },
      logger: createLogger("langwatch:auth:test"),
      prisma: {} as never,
      redis: null as never,
      rateLimiter: limiter,
      secrets: {
        find: () => undefined,
        read: (key: string) => {
          throw new Error(`test double does not stub secrets.read("${key}")`);
        },
      },
      publicBaseUrl: undefined,
      identityEmails: undefined as never,
      route: undefined as never,
      signUp: null,
      invites: null,
      authProvider: undefined as never,
      federatedProvider: undefined,
      isSaas: false,
      nodeEnvironment: undefined,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
    secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
  });
}

describe("given a signed-in caller asking for their own confirmation link", () => {
  describe("when the process resolved no address for the account", () => {
    it("refuses by name before spending any budget", async () => {
      const { rateLimiter, windows } = countingLimiter();
      const app = await appFor(rateLimiter);

      await expect(
        app.sendMyAddressConfirmation({ actorId: "user_ana", email: null }),
      ).rejects.toMatchObject({ code: "auth_no_address_to_confirm" });
      expect(windows).toEqual([]);
    });
  });

  describe("when the caller has spent the hour's budget", () => {
    it("refuses with the throttle's code and the wait the counter measured", async () => {
      const { rateLimiter, windows } = countingLimiter();
      const app = await appFor(rateLimiter);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await app
          .sendMyAddressConfirmation({ actorId: "user_ana", email: "ana@acme.com" })
          .catch(() => null);
      }
      const refusal = await app
        .sendMyAddressConfirmation({ actorId: "user_ana", email: "ana@acme.com" })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "auth_rate_limited",
        httpStatus: 429,
        meta: { retryAfterSeconds: 60 },
      });
      expect(windows).toEqual(Array.from({ length: 11 }, () => ({ requests: 10, seconds: 3600 })));
    });
  });

  describe("when the caller is inside the budget", () => {
    it("asks sign-up to mail the link, which this deployment cannot send", async () => {
      const { rateLimiter } = countingLimiter();
      const app = await appFor(rateLimiter);

      await expect(
        app.sendMyAddressConfirmation({ actorId: "user_ana", email: "ana@acme.com" }),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });
  });
});
