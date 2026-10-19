/**
 * The seed, the recovery path and the Operators page's rules.
 * Spec: modules/ops/specs/platform-operator-bootstrap.feature
 */
import {
  PlatformOperatorLastHolderError,
  PlatformOperatorSelfGrantError,
  type AuthzApi,
  type AuthzGrantPlatformOperatorInput,
  type PlatformOperator,
} from "@langwatch/authz-contract";
import type { NotificationService as NotificationApi } from "@langwatch/notification-contract";
import type * as observabilityModule from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { UserApi, UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import {
  PLATFORM_OPERATOR_SEED_ACTOR,
  PLATFORM_OPERATOR_TASK_ACTOR,
  PlatformOperatorsService,
} from "../platform-operators.service.ts";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }),
}));

function user(id: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id,
    name: id,
    email: `${id}@acme.com`,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    lastLoginAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

function holder(userId: string): PlatformOperator {
  return {
    grantId: `grant_${userId}`,
    userId,
    grantedAt: Temporal.Instant.fromEpochMilliseconds(0),
  };
}

const SELF_HOSTED = { cloud: false, isLocalDevelopment: false };
const HOSTED_CLOUD = { cloud: true, isLocalDevelopment: false };

function world({
  holders = [],
  users = [],
  organizations = [],
  administrators = [],
  deployment = SELF_HOSTED,
  isEmailUnconfigured = false,
}: {
  holders?: PlatformOperator[];
  users?: UserProfile[];
  organizations?: string[];
  administrators?: string[];
  deployment?: { cloud: boolean; isLocalDevelopment: boolean };
  isEmailUnconfigured?: boolean;
} = {}) {
  const granted: AuthzGrantPlatformOperatorInput[] = [];
  const authz: Pick<
    AuthzApi,
    "grantPlatformOperator" | "revokePlatformOperator" | "listPlatformOperators"
  > = {
    listPlatformOperators: async () => holders,
    grantPlatformOperator: async (input) => {
      granted.push(input);
      return holder(input.principal.id ?? "anyone");
    },
    revokePlatformOperator: vi.fn(async () => undefined),
  };
  const directory: Pick<
    UserApi,
    "findByEmail" | "findById" | "countUsage" | "isOldestActiveAccount"
  > = {
    countUsage: async () => {
      const emailDomains: Record<string, number> =
        users.length > 0 ? { "acme.com": users.length } : {};
      return { emailDomains };
    },
    findByEmail: async ({ email }) =>
      users.find((candidate) => candidate.email === email.toLowerCase()) ?? null,
    findById: async ({ id }) => users.find((candidate) => candidate.id === id) ?? null,
    isOldestActiveAccount: async ({ userId }) =>
      users
        .filter((candidate) => candidate.deactivatedAt === null)
        .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.id === userId,
  };
  const mail = createApiFixture<Pick<NotificationApi, "getMailDelivery">>({
    getMailDelivery: async () => ({
      ...(isEmailUnconfigured ? {} : { provider: "smtp" as const }),
      smtpConfigured: !isEmailUnconfigured,
      smtpSendsCredentials: false,
      misconfigured: false,
    }),
  });
  const organizationDirectory: Pick<
    OrganizationApi,
    "listProvisioningSummaries" | "findAdministrators"
  > = {
    listProvisioningSummaries: async () =>
      organizations.map((id) => ({
        id,
        name: id,
        slug: id,
        createdAt: Temporal.Instant.fromEpochMilliseconds(0),
      })),
    findAdministrators: async () =>
      administrators.map((userId) => ({ userId, name: null, email: null })),
  };
  const service = PlatformOperatorsService.create({
    authz,
    users: directory,
    organizations: organizationDirectory,
    mail,
    deployment,
  });
  return { service, granted, authz };
}

describe("PlatformOperatorsService", () => {
  describe("when the seed runs", () => {
    function seeding(options: Parameters<typeof world>[0]) {
      const seeded = world(options);
      const record = vi.fn(async () => undefined);
      seeded.service.connectSeedRecorder({ record });
      return { ...seeded, record };
    }

    describe("given a fresh install with no user yet", () => {
      /** @scenario "A fresh install waits for its first user before seeding" */
      it("grants nothing and records nothing, so the next wake asks again", async () => {
        const { service, granted, record } = seeding({ organizations: [] });

        const outcome = await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: false });

        expect(outcome.via).toBe("waiting");
        expect(granted).toEqual([]);
        expect(record).not.toHaveBeenCalled();
      });

      /** @scenario "A fresh install waits for its first user before seeding" */
      it("records the decision once the first user exists, and grants nothing itself", async () => {
        const { service, granted, record } = seeding({
          users: [user("ana")],
          organizations: ["org_1"],
          administrators: ["ana"],
        });

        const outcome = await service.seedOnce({ adminEmails: [], cloud: false });

        expect(outcome).toMatchObject({ via: "sole-organization-admin", userIds: ["ana"] });
        expect(record).toHaveBeenCalledWith({ via: "sole-organization-admin", userIds: ["ana"] });
        expect(granted).toEqual([]);
      });
    });

    describe("given users exist but no organization yet", () => {
      /** @scenario "Users with no organization yet wait, and nothing latches" */
      it("waits without recording, then decides once the organization exists", async () => {
        const organizations: string[] = [];
        const { service, record } = seeding({
          users: [user("ana")],
          organizations,
          administrators: ["ana"],
        });

        const before = await service.seedOnce({ adminEmails: [], cloud: false });
        expect(before).toMatchObject({
          via: "waiting",
          reason: expect.stringMatching(/organization/),
        });
        expect(record).not.toHaveBeenCalled();

        organizations.push("org_1");
        await service.seedOnce({ adminEmails: [], cloud: false });
        expect(record).toHaveBeenCalledWith({ via: "sole-organization-admin", userIds: ["ana"] });
      });
    });

    describe("given ADMIN_EMAILS names a verified user and an unverified one", () => {
      /** @scenario "A still-set ADMIN_EMAILS seeds its verified users once" */
      it("decides only the verified user, then grants them as the system with source migration", async () => {
        const { service, granted, record } = seeding({
          users: [user("ana"), user("bo", { emailVerified: false })],
          organizations: ["org_1"],
          administrators: ["bo"],
        });

        await service.seedOnce({ adminEmails: ["Ana@acme.com", "bo@acme.com"], cloud: false });
        expect(record).toHaveBeenCalledWith({ via: "admin-emails", userIds: ["ana"] });

        await service.grantSeeded({ via: "admin-emails", userIds: ["ana"] });
        expect(granted).toEqual([
          {
            principal: { type: "user", id: "ana" },
            caller: { type: "system" },
            actor: PLATFORM_OPERATOR_SEED_ACTOR,
            source: "migration",
          },
        ]);
      });
    });

    describe("given ADMIN_EMAILS is set but names no verified active user", () => {
      /** @scenario "A set ADMIN_EMAILS waits for a named verified user and never falls back" */
      it("waits unlatched past the only organization's admin, warning once per process", async () => {
        const users = [user("stranger"), user("ana", { emailVerified: false })];
        const { service, granted, record } = seeding({
          users,
          organizations: ["org_1"],
          administrators: ["stranger"],
        });
        warn.mockClear();

        const first = await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: false });
        await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: false });

        expect(first).toMatchObject({
          via: "waiting",
          reason: expect.stringMatching(/ADMIN_EMAILS/),
        });
        expect(record).not.toHaveBeenCalled();
        expect(granted).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]?.[1]).toMatch(/waiting: no user named by ADMIN_EMAILS/);

        users[1] = user("ana");
        await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: false });
        expect(record).toHaveBeenCalledWith({ via: "admin-emails", userIds: ["ana"] });
      });

      /** @scenario "A set ADMIN_EMAILS waits for a named verified user and never falls back" */
      it("waits too when nobody holds the named address", async () => {
        const { service, record } = seeding({
          users: [user("stranger")],
          organizations: ["org_1"],
          administrators: ["stranger"],
        });

        const outcome = await service.seedOnce({ adminEmails: ["ghost@acme.com"], cloud: false });

        expect(outcome.via).toBe("waiting");
        expect(record).not.toHaveBeenCalled();
      });
    });

    describe("given the install has no email configured and a later sign-up holds the named address", () => {
      const squatted = {
        users: [
          user("first", { createdAt: new Date("2024-01-01T00:00:00Z") }),
          user("ana", { emailVerified: false }),
        ],
        organizations: ["org_1"],
        administrators: ["first"],
        isEmailUnconfigured: true,
      };

      /** @scenario "With no email configured a named unverified account that signed up later waits" */
      it("waits unlatched and says the account is not the install's oldest", async () => {
        const { service, granted, record } = seeding(squatted);
        warn.mockClear();

        const outcome = await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: false });

        expect(outcome).toMatchObject({
          via: "waiting",
          reason: expect.stringMatching(/not the install's oldest active account/),
        });
        expect(record).not.toHaveBeenCalled();
        expect(granted).toEqual([]);
        expect(warn.mock.calls[0]?.[1]).toMatch(/oldest active account/);
      });

      /** @scenario "With no email configured a named unverified account that signed up later waits" */
      it("grants nobody through the upgrade step", async () => {
        const { service, granted } = world(squatted);

        await expect(
          service.seedFromAdminEmails({
            settings: { adminEmails: ["ana@acme.com"], cloud: false },
            dryRun: false,
          }),
        ).resolves.toBe(0);
        expect(granted).toEqual([]);
      });

      /** @scenario "With no email configured a named unverified account that signed up later waits" */
      it("still seeds a verified named user beside it", async () => {
        const { service, record } = seeding({
          ...squatted,
          users: [...squatted.users, user("bo")],
        });

        await service.seedOnce({ adminEmails: ["ana@acme.com", "bo@acme.com"], cloud: false });

        expect(record).toHaveBeenCalledWith({ via: "admin-emails", userIds: ["bo"] });
      });
    });

    describe("given the install has no email configured and the named user is unverified", () => {
      const unverified = {
        users: [
          user("ana", { emailVerified: false, createdAt: new Date("2024-01-01T00:00:00Z") }),
          user("stranger"),
        ],
        organizations: ["org_1"],
        administrators: ["stranger"],
        isEmailUnconfigured: true,
      };

      /** @scenario "An install with no email configured seeds the named user unverified" */
      it("decides the named user, and never the organization's admin", async () => {
        const { service, record } = seeding(unverified);

        const outcome = await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: false });

        expect(outcome.via).toBe("admin-emails");
        expect(record).toHaveBeenCalledWith({ via: "admin-emails", userIds: ["ana"] });
      });

      /** @scenario "An install with no email configured seeds the named user unverified" */
      it("grants them through the upgrade step too", async () => {
        const { service, granted } = world(unverified);

        await expect(
          service.seedFromAdminEmails({
            settings: { adminEmails: ["ana@acme.com"], cloud: false },
            dryRun: false,
          }),
        ).resolves.toBe(1);
        expect(granted.map((grant) => grant.principal)).toEqual([{ type: "user", id: "ana" }]);
      });

      /** @scenario "An install with no email configured seeds the named user unverified" */
      it("still skips a deactivated named user", async () => {
        const { service, record } = seeding({
          ...unverified,
          users: [user("ana", { emailVerified: false, deactivatedAt: new Date() })],
        });

        const outcome = await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: false });

        expect(outcome.via).toBe("waiting");
        expect(record).not.toHaveBeenCalled();
      });

      /** @scenario "An install with no email configured seeds the named user unverified" */
      it("waits for an address nobody has signed up with yet", async () => {
        const { service, record } = seeding(unverified);

        const outcome = await service.seedOnce({ adminEmails: ["ghost@acme.com"], cloud: false });

        expect(outcome.via).toBe("waiting");
        expect(record).not.toHaveBeenCalled();
      });
    });

    describe("given ADMIN_EMAILS is empty and the install has one organization", () => {
      /** @scenario "With ADMIN_EMAILS empty the oldest active admin of the only organization is seeded" */
      it("decides the oldest active administrator", async () => {
        const { service, record } = seeding({
          users: [
            user("old_but_gone", {
              createdAt: new Date("2020-01-01T00:00:00Z"),
              deactivatedAt: new Date("2024-01-01T00:00:00Z"),
            }),
            user("oldest", { createdAt: new Date("2021-01-01T00:00:00Z") }),
            user("newer", { createdAt: new Date("2023-01-01T00:00:00Z") }),
          ],
          organizations: ["org_1"],
          administrators: ["newer", "old_but_gone", "oldest"],
        });

        const outcome = await service.seedOnce({ adminEmails: [], cloud: false });

        expect(outcome).toMatchObject({ via: "sole-organization-admin", userIds: ["oldest"] });
        expect(record).toHaveBeenCalledWith({
          via: "sole-organization-admin",
          userIds: ["oldest"],
        });
      });
    });

    describe("given ADMIN_EMAILS is empty and the install has two organizations", () => {
      /** @scenario "With several organizations nobody is seeded and the way in is logged" */
      it("records a nobody decision, so it latches, and names the task", async () => {
        const { service, granted, record } = seeding({
          users: [user("ana")],
          organizations: ["org_1", "org_2"],
          administrators: ["ana"],
        });
        warn.mockClear();

        const outcome = await service.seedOnce({ adminEmails: [], cloud: false });

        expect(outcome.reason).toMatch(/2 organizations/);
        expect(record).toHaveBeenCalledWith({ via: "none", userIds: [] });
        expect(granted).toEqual([]);
        expect(warn.mock.calls[0]?.[1]).toMatch(/grant-platform-operator/);
      });
    });

    describe("given the deployment is the hosted service", () => {
      /** @scenario "The hosted service never bootstraps" */
      it("decides nobody, whatever ADMIN_EMAILS says", async () => {
        const { service, record } = seeding({
          users: [user("ana")],
          organizations: ["org_1"],
          administrators: ["ana"],
        });

        await service.seedOnce({ adminEmails: ["ana@acme.com"], cloud: true });

        expect(record).toHaveBeenCalledWith({ via: "none", userIds: [] });
      });
    });

    describe("given someone already holds the grant", () => {
      /** @scenario "A seed that finds operators already granted grants nobody" */
      it("decides nobody", async () => {
        const { service, record } = seeding({
          holders: [holder("ana")],
          users: [user("ana"), user("bo")],
          organizations: ["org_1"],
          administrators: ["bo"],
        });

        await service.seedOnce({ adminEmails: ["bo@acme.com"], cloud: false });

        expect(record).toHaveBeenCalledWith({ via: "none", userIds: [] });
      });
    });

    describe("given recording the decision fails and every holder is gone", () => {
      /** @scenario "A seed whose decision never recorded grants nobody" */
      it("grants nobody on any attempt: only a recorded decision is granted", async () => {
        const { service, granted } = world({
          users: [user("ana")],
          organizations: ["org_1"],
          administrators: ["ana"],
        });
        service.connectSeedRecorder({
          record: async () => {
            throw new Error("record command dead-lettered");
          },
        });

        await expect(service.seedOnce({ adminEmails: [], cloud: false })).rejects.toThrow(
          "dead-lettered",
        );
        await expect(service.seedOnce({ adminEmails: [], cloud: false })).rejects.toThrow(
          "dead-lettered",
        );

        expect(granted).toEqual([]);
      });
    });
  });

  describe("when the task grants as the system", () => {
    /** @scenario "The recovery task grants the role as the system" */
    it("grants the account behind the address as the system", async () => {
      const { service, granted } = world({ users: [user("ana")] });

      const result = await service.grantAsSystem({ email: "ana@acme.com" });

      expect(result).toMatchObject({ userId: "ana", email: "ana@acme.com" });
      expect(granted[0]).toMatchObject({
        caller: { type: "system" },
        actor: PLATFORM_OPERATOR_TASK_ACTOR,
      });
    });

    /** @scenario "The recovery task refuses an address nobody active holds" */
    it("refuses an unknown or deactivated address", async () => {
      const { service } = world({
        users: [user("gone", { deactivatedAt: new Date("2024-01-01T00:00:00Z") })],
      });

      await expect(service.grantAsSystem({ email: "nobody@acme.com" })).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
      });
      await expect(service.grantAsSystem({ email: "gone@acme.com" })).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
      });
    });

    /** @scenario "The recovery task refuses an account whose address was never verified" */
    it.each([
      ["a self-hosted install", SELF_HOSTED],
      ["the hosted cloud", HOSTED_CLOUD],
    ])("refuses an unverified account on %s and grants nobody", async (_label, deployment) => {
      const { service, granted } = world({
        users: [user("squatter", { emailVerified: false })],
        deployment,
      });

      await expect(service.grantAsSystem({ email: "squatter@acme.com" })).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
        meta: { userId: "squatter" },
      });
      expect(granted).toEqual([]);
    });
  });

  describe("when the Operators page asks", () => {
    const operator = { id: "ana", email: "ana@acme.com", impersonator: null };

    /** @scenario "An operator grants the role to another existing user" */
    it("grants with the signed-in operator as caller and actor", async () => {
      const { service, granted } = world({ users: [user("ana"), user("bo")] });

      await service.grant({ email: "bo@acme.com", operator });

      expect(granted).toEqual([
        {
          principal: { type: "user", id: "bo" },
          caller: { type: "user", id: "ana" },
          actor: { type: "user", id: "ana" },
          source: "grants-service",
        },
      ]);
    });

    /** @scenario "The page refuses granting yourself" */
    it("passes authz's self-grant refusal through", async () => {
      const { service, authz } = world({ users: [user("ana")] });
      authz.grantPlatformOperator = async () => {
        throw new PlatformOperatorSelfGrantError({ userId: "ana" });
      };

      await expect(service.grant({ email: "ana@acme.com", operator })).rejects.toMatchObject({
        code: "platform_operator_self_grant",
      });
    });

    /** @scenario "The page refuses revoking the last holder" */
    it("passes authz's last-holder refusal through", async () => {
      const { service, authz } = world({ holders: [holder("ana")], users: [user("ana")] });
      authz.revokePlatformOperator = async () => {
        throw new PlatformOperatorLastHolderError({ grantId: "grant_ana", userId: "ana" });
      };

      await expect(service.revoke({ grantId: "grant_ana", operator })).rejects.toMatchObject({
        code: "platform_operator_last_holder",
      });
    });

    /** @scenario "The page refuses an account whose address was never verified" */
    it("refuses an unverified account on the page and grants nobody", async () => {
      const { service, granted } = world({
        users: [user("ana"), user("squatter", { emailVerified: false })],
      });

      await expect(service.grant({ email: "squatter@acme.com", operator })).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
      });
      expect(granted).toEqual([]);
    });

    /** @scenario "A refused grant never carries the address" */
    it("names no address in the refusal, and carries the account id when there is one", async () => {
      const { service } = world({
        users: [user("ana"), user("gone", { deactivatedAt: new Date("2024-01-01T00:00:00Z") })],
      });

      for (const email of ["nobody@acme.com", "gone@acme.com"]) {
        const refusal: unknown = await service.grant({ email, operator }).catch((error) => error);
        expect(refusal).toBeInstanceOf(Error);
        expect(String(refusal) + JSON.stringify(refusal)).not.toContain(email);
      }
      await expect(service.grant({ email: "gone@acme.com", operator })).rejects.toMatchObject({
        meta: { userId: "gone" },
      });
    });

    /** @scenario "An impersonated session cannot change who operates" */
    it("refuses grant and revoke from an impersonated session", async () => {
      const { service, granted, authz } = world({ users: [user("ana"), user("bo")] });
      const impersonating = { id: "customer", impersonator: { id: "ana" } };

      await expect(
        service.grant({ email: "bo@acme.com", operator: impersonating }),
      ).rejects.toMatchObject({ code: "ops_impersonated_operator_refused" });
      await expect(
        service.revoke({ grantId: "grant_bo", operator: impersonating }),
      ).rejects.toMatchObject({ code: "ops_impersonated_operator_refused" });
      expect(granted).toEqual([]);
      expect(authz.revokePlatformOperator).not.toHaveBeenCalled();
    });
  });
});

describe("PlatformOperatorsService staff-only grants", () => {
  const operator = { id: "ana", email: "ana@langwatch.ai", impersonator: null };
  const ana = user("ana", { email: "ana@langwatch.ai" });

  /** Both ways in, the page and the recovery task, for one address. */
  function grantBothWays({
    email,
    users,
    deployment,
  }: {
    email: string;
    users: UserProfile[];
    deployment: { cloud: boolean; isLocalDevelopment: boolean };
  }) {
    const { service, granted } = world({ users: [ana, ...users], deployment });
    return {
      granted,
      page: () => service.grant({ email, operator }),
      task: () => service.grantAsSystem({ email }),
    };
  }

  describe("given the hosted cloud", () => {
    /** @scenario "On the hosted cloud the page and the task grant a verified staff account" */
    it("grants a verified account on langwatch.ai on the page and through the task", async () => {
      const bo = user("bo", { email: "bo@langwatch.ai" });
      const { page, task, granted } = grantBothWays({
        email: "bo@langwatch.ai",
        users: [bo],
        deployment: HOSTED_CLOUD,
      });

      await expect(page()).resolves.toMatchObject({ userId: "bo" });
      await expect(task()).resolves.toMatchObject({ userId: "bo" });
      expect(granted.map(({ principal }) => principal.id)).toEqual(["bo", "bo"]);
    });

    /** @scenario "On the hosted cloud an account outside the staff domain is refused" */
    it.each([
      ["another domain", "bo@acme.com"],
      ["a subdomain", "bo@eu.langwatch.ai"],
      ["a lookalike suffix", "bo@langwatch.ai.acme.com"],
      ["a lookalike prefix", "bo@notlangwatch.ai"],
      ["a trailing dot", "bo@langwatch.ai."],
    ])("refuses a verified address on %s and grants nobody", async (_label, email) => {
      const { page, task, granted } = grantBothWays({
        email,
        users: [user("bo", { email })],
        deployment: HOSTED_CLOUD,
      });

      await expect(page()).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
        meta: { userId: "bo" },
      });
      await expect(task()).rejects.toMatchObject({ code: "platform_operator_user_not_found" });
      expect(granted).toEqual([]);
    });

    /** @scenario "On the hosted cloud an unverified staff address is refused" */
    it("refuses an unverified address on langwatch.ai and grants nobody", async () => {
      const { page, task, granted } = grantBothWays({
        email: "bo@langwatch.ai",
        users: [user("bo", { email: "bo@langwatch.ai", emailVerified: false })],
        deployment: HOSTED_CLOUD,
      });

      await expect(page()).rejects.toMatchObject({ code: "platform_operator_user_not_found" });
      await expect(task()).rejects.toMatchObject({ code: "platform_operator_user_not_found" });
      expect(granted).toEqual([]);
    });
  });

  describe("given a self-hosted install", () => {
    /** @scenario "A self-hosted install grants any verified active account" */
    it("grants a verified account on the install's own domain both ways", async () => {
      const { page, task, granted } = grantBothWays({
        email: "bo@acme.com",
        users: [user("bo")],
        deployment: SELF_HOSTED,
      });

      await page();
      await task();
      expect(granted.map(({ principal }) => principal.id)).toEqual(["bo", "bo"]);
    });
  });

  describe("given a local development stack running as the hosted cloud", () => {
    /** @scenario "A developer's local stack grants its own seeded admin" */
    it("grants the seeded admin through the task", async () => {
      const admin = user("admin", { email: "admin@mail.langwatch.localhost" });
      const { task, granted } = grantBothWays({
        email: "admin@mail.langwatch.localhost",
        users: [admin],
        deployment: { cloud: true, isLocalDevelopment: true },
      });

      await expect(task()).resolves.toMatchObject({ userId: "admin" });
      expect(granted.map(({ principal }) => principal.id)).toEqual(["admin"]);
    });
  });
});

describe("PlatformOperatorsService.seedFromAdminEmails", () => {
  const settings = { adminEmails: ["ada@acme.com", "bob@acme.com"], cloud: false };
  const users = [user("ada"), user("bob", { emailVerified: false })];

  describe("given nobody holds the grant and ADMIN_EMAILS names a verified and an unverified user", () => {
    /** @scenario "The upgrade step grants the verified users a still-set ADMIN_EMAILS names" */
    it("grants only the verified user, as the system, with source migration", async () => {
      const { service, granted } = world({ users });

      await expect(service.seedFromAdminEmails({ settings, dryRun: false })).resolves.toBe(1);

      expect(granted).toEqual([
        expect.objectContaining({
          principal: { type: "user", id: "ada" },
          caller: { type: "system" },
          actor: PLATFORM_OPERATOR_SEED_ACTOR,
          source: "migration",
        }),
      ]);
    });

    /** @scenario "The upgrade step grants the verified users a still-set ADMIN_EMAILS names" */
    it("grants nobody on a dry run and counts the one it would grant", async () => {
      const { service, granted } = world({ users });

      await expect(service.seedFromAdminEmails({ settings, dryRun: true })).resolves.toBe(1);
      expect(granted).toEqual([]);
    });
  });

  describe("given any case the seed's wait decides", () => {
    /** @scenario "The upgrade step leaves every other case to the seed's wait" */
    it.each([
      { case: "a holder exists", holders: [holder("carol")], step: settings },
      { case: "ADMIN_EMAILS is empty", holders: [], step: { adminEmails: [], cloud: false } },
      {
        case: "no named user is verified",
        holders: [],
        step: { ...settings, adminEmails: ["bob@acme.com"] },
      },
      { case: "the hosted service", holders: [], step: { ...settings, cloud: true } },
    ])("grants nobody when $case", async ({ holders, step }) => {
      const { service, granted } = world({ users, holders });

      await expect(service.seedFromAdminEmails({ settings: step, dryRun: false })).resolves.toBe(0);
      expect(granted).toEqual([]);
    });
  });
});

describe("PlatformOperatorsService.grantFirstUser", () => {
  const selfHosted = { adminEmails: ["someone-else@acme.com"], cloud: false };

  function signingUp(options: Parameters<typeof world>[0]) {
    const seeded = world(options);
    const record = vi.fn(async () => undefined);
    seeded.service.connectSeedRecorder({ record });
    return { ...seeded, record };
  }

  describe("given a self-hosted install nobody operates and its only user was created", () => {
    /** @scenario "The first user of a self-hosted install becomes a platform operator" */
    it("records that user as the seed's decision, whatever ADMIN_EMAILS names", async () => {
      const { service, record, granted } = signingUp({ users: [user("ana")] });

      await expect(
        service.grantFirstUser({ userId: "ana", backfilled: false, settings: selfHosted }),
      ).resolves.toBe(true);

      expect(record).toHaveBeenCalledExactlyOnceWith({ via: "first-user", userIds: ["ana"] });
      expect(granted).toEqual([]);
    });

    /** @scenario "The first user of a self-hosted install becomes a platform operator" */
    it("grants the recorded first user as the system, as every seeded grant is", async () => {
      const { service, granted } = world({ users: [user("ana")] });

      await service.grantSeeded({ via: "first-user", userIds: ["ana"] });

      expect(granted).toEqual([
        expect.objectContaining({
          principal: { type: "user", id: "ana" },
          caller: { type: "system" },
          actor: PLATFORM_OPERATOR_SEED_ACTOR,
        }),
      ]);
    });
  });

  describe("given another user already exists", () => {
    /** @scenario "A second user never becomes an operator by signing up" */
    it("records nothing for the second user", async () => {
      const { service, record } = signingUp({ users: [user("ana"), user("bo")] });

      await expect(
        service.grantFirstUser({ userId: "bo", backfilled: false, settings: selfHosted }),
      ).resolves.toBe(false);
      expect(record).not.toHaveBeenCalled();
    });

    /** @scenario "Two users signing up at once never both become operators" */
    it("records nothing for either of two users whose facts both find two users", async () => {
      const { service, record } = signingUp({ users: [user("ana"), user("bo")] });

      await Promise.all([
        service.grantFirstUser({ userId: "ana", backfilled: false, settings: selfHosted }),
        service.grantFirstUser({ userId: "bo", backfilled: false, settings: selfHosted }),
      ]);
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe("given the hosted service", () => {
    /** @scenario "The hosted service never makes its first user an operator" */
    it("records nothing", async () => {
      const { service, record } = signingUp({ users: [user("ana")] });

      await expect(
        service.grantFirstUser({
          userId: "ana",
          backfilled: false,
          settings: { ...selfHosted, cloud: true },
        }),
      ).resolves.toBe(false);
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe("given somebody already holds the grant", () => {
    /** @scenario "An existing operator means no first-user grant" */
    it("records nothing and grants nobody", async () => {
      const { service, record, granted, authz } = signingUp({
        users: [user("ana")],
        holders: [holder("carol")],
      });

      await expect(
        service.grantFirstUser({ userId: "ana", backfilled: false, settings: selfHosted }),
      ).resolves.toBe(false);
      expect(record).not.toHaveBeenCalled();
      expect(granted).toEqual([]);
      expect(authz.revokePlatformOperator).not.toHaveBeenCalled();
    });
  });

  describe("given a backfilled fact for the install's only user", () => {
    /** @scenario "A backfilled or stale creation fact grants nobody" */
    it("records nothing", async () => {
      const { service, record } = signingUp({ users: [user("ana")] });

      await expect(
        service.grantFirstUser({ userId: "ana", backfilled: true, settings: selfHosted }),
      ).resolves.toBe(false);
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe("given the fact names a user who is gone or deactivated", () => {
    /** @scenario "A backfilled or stale creation fact grants nobody" */
    it.each([
      { case: "erased", users: [user("bo")] },
      {
        case: "deactivated",
        users: [user("ana", { deactivatedAt: new Date("2025-02-01T00:00:00Z") })],
      },
    ])("records nothing when the user was $case", async ({ users }) => {
      const { service, record } = signingUp({ users });

      await expect(
        service.grantFirstUser({ userId: "ana", backfilled: false, settings: selfHosted }),
      ).resolves.toBe(false);
      expect(record).not.toHaveBeenCalled();
    });
  });
});
