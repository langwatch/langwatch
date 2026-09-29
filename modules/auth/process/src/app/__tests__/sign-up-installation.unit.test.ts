import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type {
  MailDeliveryView,
  NotificationService,
  SendEmailCommand,
} from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { resolvedSecrets } from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { redisDouble } from "@langwatch/test-harness/client-doubles/redis";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { authServer } from "../../auth.server.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";

/** A signed-out sign-up through the installed auth module, memory rows and a recording mailer. */
async function bootAuth({
  sent,
  mailDelivery = { provider: "smtp", smtpConfigured: true, misconfigured: false },
}: {
  sent: SendEmailCommand[];
  mailDelivery?: MailDeliveryView;
}) {
  const resolver = SecretsResolver.over(SecretsChain.start({ environment: {} }));
  return createApp({ role: "api", secrets: (owner, declared) => resolver.scopeTo(owner, declared) })
    .withModules([withMemoryRepositories(authServer)])
    .withMembers({
      publicBaseUrl: "https://app.acme.test",
      isSaas: false,
      nodeEnvironment: "test",
      rateLimiter: { check: async () => ({ allowed: true }) },
      logging: createLogger("langwatch:auth:sign-up-installation"),
    })
    .withEncryption({ encrypt: (value) => value, decrypt: (value) => value })
    .withSecrets(resolvedSecrets({}))
    .withRelational(prismaDouble({}))
    .withKeyvalue(redisDouble({}))
    .withConfig({
      auth: {
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
    })
    .provide({
      user: createApiFixture<UserApi>({ findByEmail: async () => null }),
      "api-key": createApiFixture<ApiKeyApi>(),
      "feature-flag": createApiFixture<FeatureFlagApi>(),
      identity: createApiFixture<IdentityApi>({
        routeSignIn: async () => ({
          outcome: "route_to_signup",
          methodSet: [],
          reasonCode: "identifier_unknown",
        }),
      }),
      organization: createApiFixture<OrganizationApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
      notification: createApiFixture<NotificationService>({
        getMailDelivery: async () => mailDelivery,
        sendEmail: async (message) => {
          sent.push(message);
        },
      }),
      sso: createApiFixture<SsoApi>(),
      authz: createApiFixture<AuthzApi>(),
      nurturing: createApiFixture<NurturingApi>(),
    })
    .boot();
}

describe("sign-up installation", () => {
  describe("when a signed-out visitor asks for a new account's confirmation link", () => {
    it("mails the link, built on this deployment's public address", async () => {
      const sent: SendEmailCommand[] = [];
      const runtime = await bootAuth({ sent });
      try {
        await runtime.service(AuthApi).requestNewAccountVerification({ email: "Sam@Acme.com" });

        expect(sent).toHaveLength(1);
        expect(sent[0]?.to).toBe("sam@acme.com");
        expect(sent[0]?.html).toContain("https://app.acme.test/auth/signup?verify=");
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when this installation has no email configured at all", () => {
    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("mails nothing and answers the unconfirmed proof a password sign-up spends", async () => {
      const sent: SendEmailCommand[] = [];
      const runtime = await bootAuth({
        sent,
        mailDelivery: { smtpConfigured: false, misconfigured: false },
      });
      try {
        const answer = await runtime
          .service(AuthApi)
          .requestNewAccountVerification({ email: "sam@acme.com" });

        expect(answer).toEqual({ sent: false, addressProof: expect.any(String) });
        expect(sent).toEqual([]);
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the email provider this installation names cannot be used", () => {
    /** @scenario "A misconfigured email provider keeps sign-up on the mailed link" */
    it("issues no unconfirmed proof and attempts the mailed link", async () => {
      const sent: SendEmailCommand[] = [];
      const runtime = await bootAuth({
        sent,
        mailDelivery: { smtpConfigured: false, misconfigured: true },
      });
      try {
        await expect(
          runtime.service(AuthApi).requestNewAccountVerification({ email: "sam@acme.com" }),
        ).resolves.toEqual({ sent: true });
        expect(sent).toHaveLength(1);
      } finally {
        await runtime.stop();
      }
    });
  });
});
