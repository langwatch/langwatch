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
import type * as observabilityModule from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
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

function world({
  holders = [],
  users = [],
  organizations = [],
  administrators = [],
}: {
  holders?: PlatformOperator[];
  users?: UserProfile[];
  organizations?: string[];
  administrators?: string[];
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
  const directory: Pick<UserApi, "findByEmail" | "findById" | "countUsage"> = {
    countUsage: async () => {
      const emailDomains: Record<string, number> =
        users.length > 0 ? { "acme.com": users.length } : {};
      return { emailDomains };
    },
    findByEmail: async ({ email }) =>
      users.find((candidate) => candidate.email === email.toLowerCase()) ?? null,
    findById: async ({ id }) => users.find((candidate) => candidate.id === id) ?? null,
  };
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

  describe("when boot reads ADMIN_EMAILS", () => {
    /** @scenario "A set ADMIN_EMAILS only warns at boot" */
    it("warns that a set list grants nothing and names the page and the task", () => {
      const [warning] = PlatformOperatorsService.bootWarnings({ adminEmails: ["ana@acme.com"] });

      expect(warning).toMatch(/grants nothing/);
      expect(warning).toMatch(/\/ops\/operators/);
      expect(warning).toMatch(/grant-platform-operator/);
      expect(PlatformOperatorsService.bootWarnings({ adminEmails: [] })).toEqual([]);
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
    it("refuses an unverified account on the page, while the task still grants it", async () => {
      const { service, granted } = world({
        users: [user("ana"), user("squatter", { emailVerified: false })],
      });

      await expect(service.grant({ email: "squatter@acme.com", operator })).rejects.toMatchObject({
        code: "platform_operator_user_not_found",
      });
      expect(granted).toEqual([]);
      await service.grantAsSystem({ email: "squatter@acme.com" });
      expect(granted.map(({ principal }) => principal.id)).toEqual(["squatter"]);
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
