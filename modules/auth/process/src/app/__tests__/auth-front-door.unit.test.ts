import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
/**
 * A signed-in caller's own confirmation link: refused without an address,
 * metered per caller, and started as identity's session-bound ceremony.
 * @see specs/identity/authentication-settings.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";
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

const CHALLENGE = "c".repeat(43);

async function appFor(
  limiter: ReturnType<typeof countingLimiter>["rateLimiter"],
  identity: IdentityApi = createApiFixture<IdentityApi>(),
  mailDelivery: { provider?: string; misconfigured?: boolean } = { provider: "smtp" },
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
      auth0ManagementClientId: undefined,
      signInProviders: NO_SIGN_IN_PROVIDERS,
    },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      users: new TestUserApi({}) as never,
      apiKeys: {
        findResolvedToken: async () => ({ project: { slug: "acme" } }),
      } as never,
      featureFlags: {} as never,
      identity,
      organizations: createApiFixture<OrganizationApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
      notifications: createApiFixture<NotificationService>({
        getMailDelivery: async () => ({
          misconfigured: false,
          ...mailDelivery,
          smtpConfigured: false,
          smtpSendsCredentials: false,
        }),
      }),
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
      invites: null,
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
        app.sendMyAddressConfirmation({
          actorId: "user_ana",
          email: null,
          codeChallenge: CHALLENGE,
        }),
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
          .sendMyAddressConfirmation({
            actorId: "user_ana",
            email: "ana@acme.com",
            codeChallenge: CHALLENGE,
          })
          .catch(() => null);
      }
      const refusal = await app
        .sendMyAddressConfirmation({
          actorId: "user_ana",
          email: "ana@acme.com",
          codeChallenge: CHALLENGE,
        })
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
    /** @scenario "The own address confirmation only ever goes to the session's own address" */
    it("starts the session-bound ceremony for the session's own address, never a sign-up link", async () => {
      const { rateLimiter } = countingLimiter();
      const started: Parameters<IdentityApi["sendOwnAddressConfirmation"]>[0][] = [];
      const app = await appFor(
        rateLimiter,
        createApiFixture<IdentityApi>({
          sendOwnAddressConfirmation: async (input) => {
            started.push(input);
            return { identifierId: "idf_own" };
          },
        }),
      );

      await expect(
        app.sendMyAddressConfirmation({
          actorId: "user_ana",
          email: "ana@acme.com",
          codeChallenge: CHALLENGE,
        }),
      ).resolves.toEqual({ identifierId: "idf_own" });
      expect(started).toEqual([
        { userId: "user_ana", email: "ana@acme.com", codeChallenge: CHALLENGE },
      ]);
    });
  });

  describe("when the installation has no email provider configured", () => {
    /** @scenario "Without a way to send email, the address confirmation nudge stays silent" */
    it("says a confirmation cannot be sent", async () => {
      const { rateLimiter } = countingLimiter();
      const app = await appFor(rateLimiter, createApiFixture<IdentityApi>(), {});

      await expect(app.getMyAddressConfirmation({ email: null })).resolves.toEqual({
        email: null,
        confirmed: false,
        canSendConfirmation: false,
      });
    });

    /** @scenario "Without a way to send email, the address confirmation nudge stays silent" */
    it("refuses to send with a named error before spending budget or starting a ceremony", async () => {
      const { rateLimiter, windows } = countingLimiter();
      const app = await appFor(rateLimiter, createApiFixture<IdentityApi>(), {});

      await expect(
        app.sendMyAddressConfirmation({
          actorId: "user_ana",
          email: "ana@acme.com",
          codeChallenge: CHALLENGE,
        }),
      ).rejects.toMatchObject({ code: "auth_email_sending_unavailable", httpStatus: 400 });
      expect(windows).toEqual([]);
    });
  });
});
