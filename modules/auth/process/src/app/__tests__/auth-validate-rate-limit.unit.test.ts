import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthValidateRateLimitedError } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
/**
 * The token check counts its callers: past the registry's per-minute ceiling
 * the answer is the handled 429, not another probe of the token store.
 *
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const CEILING = resolveRequestBound("authValidatePerIpPerMinute", "ENTERPRISE");

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
      signInProviders: NO_SIGN_IN_PROVIDERS,
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
      licensing: createApiFixture<LicensingApi>(),
      sso: createApiFixture<SsoApi>(),
      authz: createApiFixture<AuthzApi>({}),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
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
      signUp: null,
      invites: null,
      isSaas: false,
      nodeEnvironment: undefined,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
    secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
  });
}

describe("given the token check behind the registry's per-IP ceiling", () => {
  describe("when one caller probes past the ceiling", () => {
    it("answers the ceiling's worth of probes, then refuses with the handled 429", async () => {
      const { rateLimiter, windows } = countingLimiter();
      const app = await appFor(rateLimiter);

      for (let probe = 0; probe < CEILING; probe += 1) {
        await expect(
          app.findProjectSlugByToken({ token: "tok", callerKey: "ip:1.2.3.4" }),
        ).resolves.toBe("acme");
      }

      const refusal = await app
        .findProjectSlugByToken({ token: "tok", callerKey: "ip:1.2.3.4" })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(AuthValidateRateLimitedError);
      expect((refusal as AuthValidateRateLimitedError).code).toBe("auth_validate_rate_limited");
      expect((refusal as AuthValidateRateLimitedError).httpStatus).toBe(429);
      expect(windows).toEqual(
        Array.from({ length: CEILING + 1 }, () => ({ requests: CEILING, seconds: 60 })),
      );
    });

    it("counts each caller apart, so one caller's refusal leaves another untouched", async () => {
      const { rateLimiter } = countingLimiter();
      const app = await appFor(rateLimiter);

      for (let probe = 0; probe <= CEILING; probe += 1) {
        await app
          .findProjectSlugByToken({ token: "tok", callerKey: "ip:1.2.3.4" })
          .catch(() => null);
      }

      await expect(
        app.findProjectSlugByToken({ token: "tok", callerKey: "ip:5.6.7.8" }),
      ).resolves.toBe("acme");
    });
  });

  describe("when a call names no caller", () => {
    it("answers without counting, there being nobody to count", async () => {
      const { rateLimiter, windows } = countingLimiter();
      const app = await appFor(rateLimiter);

      await expect(app.findProjectSlugByToken({ token: "tok" })).resolves.toBe("acme");

      expect(windows).toEqual([]);
    });
  });
});
