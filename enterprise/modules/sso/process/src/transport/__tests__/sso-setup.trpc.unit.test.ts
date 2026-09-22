// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What an organization's own administrator reads about its connection
 * (specs/identity/sso-connection-history.feature).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { SsoMigrationView, SsoSetupApi, SsoSetupView } from "@langwatch/identity-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createSsoTestApp,
  createSsoTestEntitlements,
  createSsoTestIdentity,
  RecordingSsoConnectionLedger,
  RecordingSsoDomainCeremony,
  RecordingSsoSetupCommands,
} from "../../app/__tests__/sso.fixture.ts";
import { ssoSetupTrpcTransport } from "../sso-setup.trpc.ts";

type TestContext = { actor: { id: string } };

function runtimePorts(permits: (permission: string) => boolean): TrpcRuntimeMembers<TestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

/** A cutover half-way through: the replacement registered, sign-in still on
 *  the grandfathered provider. */
const MIGRATION: SsoMigrationView = {
  legacy: { connectionId: "ssoc_legacy", source: "legacy-grandfathered", providerId: "okta" },
  replacement: { connectionId: "ssoc_1", source: "self-serve", providerId: "Okta" },
  phase: "GRACE_LEGACY",
  selectedRoute: "legacy",
  inheritedDomains: [
    {
      domain: "acme.com",
      method: "legacy-configuration",
      proofState: "VERIFIED",
      evidenceRef: null,
      verifiedAtMs: 1_764_000_000_000,
    },
  ],
  testSignIn: { done: true, atMs: 1_764_000_000_000 },
  members: { activeCount: 12, linkedCount: 9, stragglers: [], nextCursor: "cur_2" },
  quietPeriod: { lastLegacyAuthenticationAtMs: 1_764_000_000_000, complete: false },
  scim: { status: "not-applicable" },
  blockers: [],
  canFinalize: false,
};

const ENTRY = {
  eventId: "evt_1",
  occurredAtMs: 1_764_000_000_000,
  summary: "Ana registered Okta as the identity provider.",
  carriedOver: false,
};

async function harness(
  options: {
    permits?: (permission: string) => boolean;
    setup?: SsoSetupView;
    /** The organization's plan, which the commands — and only the commands —
     *  are gated on. */
    planType?: string;
    /** The cutover identity answers for this organization, if any. */
    migration?: SsoMigrationView | null;
  } = {},
) {
  const connections = RecordingSsoConnectionLedger.create();
  const getHistory = vi.fn(async () => [ENTRY]);
  const ceremony = RecordingSsoDomainCeremony.create();
  const commands = RecordingSsoSetupCommands.create();
  const getMigrationProgress = vi.fn<SsoSetupApi["getMigrationProgress"]>(async () => ({
    migration: options.migration ?? null,
  }));
  const journey = options.setup ?? {
    connection: null,
    claims: [],
    record: null,
    goLive: null,
    legacyRoute: null,
    migration: null,
  };
  const auditLog = { record: vi.fn(async () => {}), listEntityHistory: vi.fn() };
  const app = await createSsoTestApp({
    connections,
    dependencies: {
      auditLog,
      identity: createSsoTestIdentity(
        connections,
        { getHistory },
        ceremony,
        createApiFixture<SsoSetupApi>({ getSetup: async () => journey, getMigrationProgress }),
        commands,
      ),
      entitlements: createSsoTestEntitlements(options.planType ?? "ENTERPRISE"),
    },
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: runtimePorts(options.permits ?? (() => true)),
  }).mount(ssoSetupTrpcTransport, () => app);

  return {
    auditLog,
    ceremony,
    commands,
    getHistory,
    getMigrationProgress,
    router,
    caller: router.createCaller({ actor: { id: "user_ana" } }),
  };
}

const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1" };

describe("the organization's own single sign-on surface", () => {
  describe("given the mounted router", () => {
    /** @scenario "Suspending a connection is not on the customer's surface" */
    it("exposes the setup read, the history and its signal, and the domain ceremony", async () => {
      const { router } = await harness();

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "activate",
        "checkDomainFile",
        "checkDomainRecord",
        "claimDomain",
        "discardConnection",
        "finalizeLegacyMigration",
        "getHistory",
        "getMigrationProgress",
        "getSetup",
        "onHistoryActivity",
        "proveDomain",
        "register",
        "removeConnection",
        "removeDomain",
        "rename",
        "selectMigrationRoute",
        "setArrivals",
        "startLegacyMigration",
      ]);
    });
  });

  describe("given an administrator of the organization", () => {
    it("answers the connection's history in the words identity composed", async () => {
      const { caller, getHistory } = await harness();

      await expect(caller.getHistory(TARGET)).resolves.toEqual([ENTRY]);
      expect(getHistory).toHaveBeenCalledWith(TARGET);
    });
  });

  describe("given the live signal behind the same panel", () => {
    /** @scenario "The live subscription is gated exactly like the read it refreshes" */
    it("is refused to the same reader the history itself refuses", async () => {
      const { caller } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      const refusal = await Promise.resolve(caller.onHistoryActivity(TARGET))
        .then(async (stream) => {
          await stream[Symbol.asyncIterator]().next();
          return null;
        })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given a reader who may see single sign-on but not manage it", () => {
    it("still reads where the setup stands, which is what the page renders", async () => {
      const { caller } = await harness({
        permits: (permission) => permission === "sso:view",
        setup: {
          connection: null,
          claims: [],
          record: null,
          goLive: null,
          legacyRoute: null,
          migration: null,
        },
      });

      await expect(caller.getSetup({ organizationId: "org_acme" })).resolves.toMatchObject({
        connection: null,
      });
    });

    /** @scenario "Seeing the history takes managing single sign-on, not only seeing it" */
    it("refuses, because the history is nearer an audit trail than a state", async () => {
      const { caller, getHistory } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.getHistory(TARGET)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getHistory).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator running the domain ceremony", () => {
    /** @scenario "The ceremony names the administrator the surface authenticated" */
    it("names the session administrator on the fact, never an id from the input", async () => {
      const { caller, ceremony } = await harness();

      await expect(caller.claimDomain({ ...TARGET, domain: "acme.test" })).resolves.toEqual({
        waitsForReview: false,
        disputed: false,
      });
      expect(ceremony.claimDomain).toHaveBeenCalledWith({
        ...TARGET,
        domain: "acme.test",
        actor: { userId: "user_ana" },
      });
    });

    it("answers the record to publish, with the value identity issued once", async () => {
      const { caller } = await harness();

      await expect(caller.proveDomain({ ...TARGET, domain: "acme.test" })).resolves.toMatchObject({
        proved: false,
        record: { domain: "acme.test", value: "langwatch-domain-proof=token" },
      });
    });

    /** @scenario "The attempt is on the trail even when the ceremony refuses" */
    it("records the attempt before the ceremony runs, so a refusal is still on the trail", async () => {
      const { auditLog, caller, ceremony } = await harness();
      ceremony.checkDomainRecord.mockRejectedValueOnce(new Error("nothing published yet"));

      await expect(caller.checkDomainRecord({ ...TARGET, domain: "acme.test" })).rejects.toThrow(
        "nothing published yet",
      );

      expect(auditLog.record).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        action: "ssoSetup.checkDomainRecord",
        args: { ...TARGET, domain: "acme.test" },
        targetKind: "ssoConnection",
        targetId: "ssoc_1",
      });
    });
  });

  describe("given that same reader at the ceremony", () => {
    /** @scenario "Running the ceremony takes managing single sign-on, not only seeing it" */
    it("refuses every verb of it, and runs none of it", async () => {
      const { caller, ceremony } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.removeDomain({ ...TARGET, domain: "acme.test" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.checkDomainFile({ ...TARGET, domain: "acme.test" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(ceremony.removeDomain).not.toHaveBeenCalled();
      expect(ceremony.checkDomainFile).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator registering their identity provider", () => {
    it("hands identity the registration and answers the connection it minted", async () => {
      const { caller, commands } = await harness();

      await expect(
        caller.register({
          organizationId: "org_acme",
          providerId: "Okta",
          idp: {
            protocol: "oidc",
            issuer: "https://acme.okta.com",
            clientId: "client",
            clientSecret: "shhh",
          },
        }),
      ).resolves.toEqual({ connectionId: "conn-new" });

      expect(commands.register).toHaveBeenCalledWith({
        organizationId: "org_acme",
        providerId: "Okta",
        registration: {
          protocol: "oidc",
          issuer: "https://acme.okta.com",
          clientId: "client",
          clientSecret: "shhh",
        },
        actor: { userId: "user_ana" },
      });
    });

    it("records the attempt without the client secret, because the row is readable", async () => {
      const { auditLog, caller } = await harness();

      await caller.register({
        organizationId: "org_acme",
        providerId: "Okta",
        idp: {
          protocol: "oidc",
          issuer: "https://acme.okta.com",
          clientId: "client",
          clientSecret: "shhh",
        },
      });

      expect(auditLog.record).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        action: "ssoSetup.register",
        args: { organizationId: "org_acme", providerId: "Okta", protocol: "oidc" },
        targetKind: "ssoConnection",
      });
    });
  });

  describe("given an organization whose plan does not carry single sign-on", () => {
    /** @scenario "Registering an identity provider needs an Enterprise plan" */
    it("refuses to register, and commands identity with nothing", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(
        caller.register({
          organizationId: "org_acme",
          providerId: "Okta",
          idp: {
            protocol: "saml",
            entryPoint: "https://acme.okta.com/sso/saml",
            entityId: null,
            metadataXml: null,
            certificate: null,
          },
        }),
      ).rejects.toMatchObject({ cause: { code: "enterprise_plan_required" } });
      expect(commands.register).not.toHaveBeenCalled();
    });

    it("refuses to change who it admits, which is the same purchase", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(caller.setArrivals({ ...TARGET, policy: "admit" })).rejects.toMatchObject({
        cause: { code: "enterprise_plan_required" },
      });
      expect(commands.setArrivals).not.toHaveBeenCalled();
    });

    it("still answers the setup read, because a page that will not render says nothing", async () => {
      const { caller } = await harness({ planType: "LAUNCH" });

      await expect(caller.getSetup({ organizationId: "org_acme" })).resolves.toMatchObject({
        connection: null,
      });
    });

    /** @scenario "Going live needs an Enterprise plan" */
    it("refuses to turn the connection on, which is the same purchase", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(caller.activate(TARGET)).rejects.toMatchObject({
        cause: { code: "enterprise_plan_required" },
      });
      expect(commands.activate).not.toHaveBeenCalled();
    });

    /** @scenario "A lapsed subscription does not take the way back in away" */
    it("still removes the connection, because a lapse must strand nobody", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(caller.removeConnection({ ...TARGET, reason: null })).resolves.toBeUndefined();
      expect(commands.removeConnection).toHaveBeenCalledWith({
        ...TARGET,
        reason: null,
        graceMs: 7 * 24 * 60 * 60 * 1000,
        actor: { userId: "user_ana" },
      });
    });
  });

  describe("given an administrator answering who the connection admits", () => {
    it("carries the answer through under identity's own word for it", async () => {
      const { caller, commands } = await harness();

      await expect(caller.setArrivals({ ...TARGET, policy: "request" })).resolves.toBeUndefined();
      expect(commands.setArrivals).toHaveBeenCalledWith({
        ...TARGET,
        arrivalPolicy: "request",
        actor: { userId: "user_ana" },
      });
    });

    /** @scenario "Only administrators can confirm the initial arrival choice" */
    it("refuses a reader who may see single sign-on but not manage it", async () => {
      const { caller, commands } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.setArrivals({ ...TARGET, policy: "admit" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(commands.setArrivals).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator finishing a cutover", () => {
    it("carries the press to identity, naming the session administrator", async () => {
      const { caller, commands } = await harness();

      await expect(caller.finalizeLegacyMigration(TARGET)).resolves.toBeUndefined();
      expect(commands.finalizeLegacyMigration).toHaveBeenCalledWith({
        ...TARGET,
        actor: { userId: "user_ana" },
      });
    });

    it("refuses it to a reader who may see single sign-on but not manage it", async () => {
      const { caller, commands } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.finalizeLegacyMigration(TARGET)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(commands.finalizeLegacyMigration).not.toHaveBeenCalled();
    });

    it("refuses it on a plan that does not carry single sign-on", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(caller.finalizeLegacyMigration(TARGET)).rejects.toMatchObject({
        cause: { code: "enterprise_plan_required" },
      });
      expect(commands.finalizeLegacyMigration).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator turning the connection on", () => {
    it("names the session administrator and supplies no account of its own", async () => {
      const { caller, commands } = await harness();

      await expect(caller.activate(TARGET)).resolves.toBeUndefined();
      expect(commands.activate).toHaveBeenCalledWith({
        ...TARGET,
        actor: { userId: "user_ana" },
      });
    });

    it("refuses a reader who may see single sign-on but not manage it", async () => {
      const { caller, commands } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.activate(TARGET)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(commands.activate).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator taking the connection back out", () => {
    it("discards a setup that never went live, naming the session administrator", async () => {
      const { caller, commands } = await harness();

      await expect(caller.discardConnection(TARGET)).resolves.toBeUndefined();
      expect(commands.discardConnection).toHaveBeenCalledWith({
        ...TARGET,
        actor: { userId: "user_ana" },
      });
    });

    it("refuses both removals to a reader who may only see", async () => {
      const { caller, commands } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.discardConnection(TARGET)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.removeConnection({ ...TARGET, reason: null })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(commands.discardConnection).not.toHaveBeenCalled();
      expect(commands.removeConnection).not.toHaveBeenCalled();
    });
  });
  describe("given an organization mid-cutover", () => {
    it("pages the members through identity, and answers the view itself", async () => {
      const { caller, getMigrationProgress } = await harness({ migration: MIGRATION });

      await expect(
        caller.getMigrationProgress({ ...TARGET, cursor: "cur_1", limit: 50 }),
      ).resolves.toMatchObject({ phase: "GRACE_LEGACY", members: { nextCursor: "cur_2" } });
      expect(getMigrationProgress).toHaveBeenCalledWith({ ...TARGET, cursor: "cur_1", limit: 50 });
    });

    it("answers null where the organization is running no migration at all", async () => {
      const { caller } = await harness();

      await expect(
        caller.getMigrationProgress({ ...TARGET, cursor: null, limit: 25 }),
      ).resolves.toBeNull();
    });

    /** @scenario "Reading migration progress does not grant permission to change it" */
    it("lets a reader who may only see read it, and refuses them the route", async () => {
      const { caller, commands } = await harness({
        migration: MIGRATION,
        permits: (permission) => permission === "sso:view",
      });

      await expect(
        caller.getMigrationProgress({ ...TARGET, cursor: null, limit: 25 }),
      ).resolves.toMatchObject({ phase: "GRACE_LEGACY" });
      await expect(
        caller.selectMigrationRoute({ ...TARGET, route: "direct" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(commands.selectMigrationRoute).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator replacing a grandfathered connection", () => {
    it("names the connection being replaced, so the domains it proved carry over", async () => {
      const { caller, commands } = await harness();

      await expect(
        caller.startLegacyMigration({
          organizationId: "org_acme",
          legacyConnectionId: "ssoc_legacy",
          providerId: "Okta",
          idp: {
            protocol: "oidc",
            issuer: "https://acme.okta.com",
            clientId: "client",
            clientSecret: "shhh",
          },
        }),
      ).resolves.toEqual({ connectionId: "conn-replacement" });

      expect(commands.startLegacyMigration).toHaveBeenCalledWith({
        organizationId: "org_acme",
        legacyConnectionId: "ssoc_legacy",
        providerId: "Okta",
        registration: {
          protocol: "oidc",
          issuer: "https://acme.okta.com",
          clientId: "client",
          clientSecret: "shhh",
        },
        actor: { userId: "user_ana" },
      });
    });

    it("is gated on the plan, because registering a replacement is registering", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(
        caller.startLegacyMigration({
          organizationId: "org_acme",
          legacyConnectionId: "ssoc_legacy",
          providerId: "Okta",
          idp: {
            protocol: "saml",
            entryPoint: "https://acme.okta.com/sso/saml",
            entityId: null,
            metadataXml: null,
            certificate: null,
          },
        }),
      ).rejects.toMatchObject({ cause: { code: "enterprise_plan_required" } });
      expect(commands.startLegacyMigration).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator moving the route of a cutover", () => {
    it("carries the direction through to identity", async () => {
      const { caller, commands } = await harness();

      await expect(
        caller.selectMigrationRoute({ ...TARGET, route: "direct" }),
      ).resolves.toBeUndefined();
      expect(commands.selectMigrationRoute).toHaveBeenCalledWith({
        ...TARGET,
        route: "direct",
        actor: { userId: "user_ana" },
      });
    });

    it("refuses to move traffic onto the replacement without the plan that carries it", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(
        caller.selectMigrationRoute({ ...TARGET, route: "direct" }),
      ).rejects.toMatchObject({ cause: { code: "enterprise_plan_required" } });
      expect(commands.selectMigrationRoute).not.toHaveBeenCalled();
    });

    /** @scenario "A lapsed subscription does not take the way back in away" */
    it("still rolls back to the grandfathered provider, whatever the plan says", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(
        caller.selectMigrationRoute({ ...TARGET, route: "legacy" }),
      ).resolves.toBeUndefined();
      expect(commands.selectMigrationRoute).toHaveBeenCalledWith({
        ...TARGET,
        route: "legacy",
        actor: { userId: "user_ana" },
      });
    });
  });

  describe("given an administrator renaming their connection", () => {
    it("carries the name through, and is never gated on the plan", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(
        caller.rename({ ...TARGET, name: "Corporate sign-in" }),
      ).resolves.toBeUndefined();
      expect(commands.rename).toHaveBeenCalledWith({
        ...TARGET,
        name: "Corporate sign-in",
        actor: { userId: "user_ana" },
      });
    });

    /** @scenario "A name is required" */
    it("refuses a blank name before identity is asked anything", async () => {
      const { caller, commands } = await harness();

      await expect(caller.rename({ ...TARGET, name: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(commands.rename).not.toHaveBeenCalled();
    });

    it("refuses a reader who may see single sign-on but not manage it", async () => {
      const { caller, commands } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.rename({ ...TARGET, name: "Corporate sign-in" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(commands.rename).not.toHaveBeenCalled();
    });
  });
});
