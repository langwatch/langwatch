import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoMigrationView, SsoSetupApi, SsoSetupView } from "@langwatch/identity-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What an organization's own administrator reads about its connection
 * (specs/identity/sso-connection-history.feature).
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createSsoTestApp,
  createSsoTestConfig,
  createSsoTestFeatureFlags,
  createSsoTestIdentity,
  RecordingSsoBreakGlass,
  RecordingSsoConnectionLedger,
  RecordingSsoDomainCeremony,
  RecordingSsoSetupCommands,
} from "../../app/__tests__/sso.fixture.ts";
import { ssoSetupTrpcTransport } from "../sso-setup.trpc.ts";

type TestContext = { actor: { id: string } };

function runtimePorts(
  permits: (permission: string) => boolean,
  enterprise: boolean,
): TrpcRuntimeMembers<TestContext> {
  return trpcTestMembers<TestContext>({
    permits,
    overrides: { entitlements: { holds: async () => enterprise } },
  });
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
  members: {
    activeCount: 12,
    linkedCount: 9,
    nextSignInCount: 0,
    stragglers: [],
    nextCursor: "cur_2",
  },
  quietPeriod: {
    lastLegacyAuthenticationAtMs: 1_764_000_000_000,
    clearsAtMs: null,
    complete: false,
  },
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
    /** The organization's plan, which the declared gates — and only they —
     *  ask about. */
    planType?: string;
    /** The cutover identity answers for this organization, if any. */
    migration?: SsoMigrationView | null;
    /** Whether the installation held a genuine licence at startup. */
    licensed?: boolean;
    /** The hosted service, where the organization's opt-in decides instead. */
    isSaas?: boolean;
    /** Hosted organizations opted in to setting single sign-on up themselves. */
    optedIn?: readonly string[];
  } = {},
) {
  const connections = RecordingSsoConnectionLedger.create();
  const getHistory = vi.fn(async () => [ENTRY]);
  const ceremony = RecordingSsoDomainCeremony.create();
  const commands = RecordingSsoSetupCommands.create();
  const breakGlass = RecordingSsoBreakGlass.create();
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
  const auditLog = {
    record: vi.fn(async () => ({ id: "audit", occurredAt: 0 })),
    listEntityHistory: vi.fn(),
    hasRecordedSince: vi.fn(async () => false),
  };
  const app = await createSsoTestApp({
    connections,
    config: createSsoTestConfig({ isSaas: options.isSaas ?? false }),
    dependencies: {
      licensing: createApiFixture<LicensingApi>({
        inspectPlatformAccess: async () => ({
          allowed: options.licensed ?? true,
          inspections: [],
        }),
        // Several organizations, so an organization administrator publishes a record.
        getDomainClaimAuthority: async () => ({
          authorizesDomainClaims: options.licensed ?? true,
          hostsSingleOrganization: false,
          licenseDigests: [],
        }),
      }),
      auditLog,
      identity: createSsoTestIdentity({
        connections,
        history: { getHistory },
        ceremony,
        setup: createApiFixture<SsoSetupApi>({
          getSetup: async () => journey,
          getMigrationProgress,
        }),
        commands,
        breakGlass,
      }),
      featureFlags: createSsoTestFeatureFlags(options.optedIn ?? []),
    },
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: runtimePorts(
      options.permits ?? (() => true),
      (options.planType ?? "ENTERPRISE") === "ENTERPRISE",
    ),
  }).mount(ssoSetupTrpcTransport, () => app);

  return {
    auditLog,
    breakGlass,
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
        "breakGlassBindings",
        "breakGlassCandidates",
        "checkDomainFile",
        "checkDomainRecord",
        "claimDomain",
        "discardConnection",
        "finalizeLegacyMigration",
        "getHistory",
        "getMigrationProgress",
        "getSetup",
        "grantBreakGlass",
        "identityProvider",
        "onHistoryActivity",
        "proveDomain",
        "register",
        "removeConnection",
        "removeDomain",
        "rename",
        "renewBreakGlass",
        "revokeBreakGlass",
        "selectMigrationRoute",
        "setArrivals",
        "startLegacyMigration",
        "updateIdentityProvider",
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
        verified: false,
      });
      expect(ceremony.claimDomain).toHaveBeenCalledWith({
        ...TARGET,
        domain: "acme.test",
        proof: "dns-txt",
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

  describe("given an administrator editing their identity provider", () => {
    const IDP = {
      protocol: "oidc" as const,
      issuer: "https://acme.okta.com",
      clientId: "client",
      clientSecret: "shhh",
    };

    it("prefills the form with the settings identity holds, never the secret", async () => {
      const { caller, commands } = await harness();

      await expect(caller.identityProvider(TARGET)).resolves.toEqual({
        protocol: "oidc",
        issuer: "https://acme.okta.com",
        clientId: "client",
        hasClientSecret: true,
      });
      expect(commands.getIdentityProvider).toHaveBeenCalledWith(TARGET);
    });

    it("answers no settings for a grandfathered connection", async () => {
      const { caller, commands } = await harness();
      commands.getIdentityProvider.mockResolvedValueOnce({ protocol: "grandfathered" });

      await expect(caller.identityProvider(TARGET)).resolves.toBeNull();
    });

    it("passes the settings on for the same connection, and audits no secret", async () => {
      const { auditLog, caller, commands } = await harness();

      await expect(caller.updateIdentityProvider({ ...TARGET, idp: IDP })).resolves.toBeUndefined();

      expect(commands.updateIdentityProvider).toHaveBeenCalledWith({
        ...TARGET,
        idp: IDP,
        actor: { userId: "user_ana" },
      });
      expect(auditLog.record).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        action: "ssoSetup.updateIdentityProvider",
        args: { ...TARGET, protocol: "oidc" },
        targetKind: "ssoConnection",
        targetId: "ssoc_1",
      });
      expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("shhh");
    });

    it("keeps the stored secret when the field is left blank", async () => {
      const { caller, commands } = await harness();

      await caller.updateIdentityProvider({
        ...TARGET,
        idp: { protocol: "oidc", issuer: "https://acme.okta.com", clientId: "client" },
      });

      expect(commands.updateIdentityProvider).toHaveBeenCalledWith(
        expect.objectContaining({ idp: expect.objectContaining({ clientSecret: null }) }),
      );
    });

    /** @scenario "Only an administrator who may manage single sign-on can edit" */
    it("refuses a reader who may see single sign-on but not manage it", async () => {
      const { caller, commands } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.identityProvider(TARGET)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller.updateIdentityProvider({ ...TARGET, idp: IDP })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(commands.getIdentityProvider).not.toHaveBeenCalled();
      expect(commands.updateIdentityProvider).not.toHaveBeenCalled();
    });

    it("is gated on the plan like registering", async () => {
      const { caller, commands } = await harness({ planType: "LAUNCH" });

      await expect(caller.updateIdentityProvider({ ...TARGET, idp: IDP })).rejects.toMatchObject({
        cause: { code: "enterprise_plan_required" },
      });
      expect(commands.updateIdentityProvider).not.toHaveBeenCalled();
    });
  });

  describe("given an installation that never held a licence", () => {
    /** @scenario "An unlicensed self-hosted installation is told what would change that" */
    it("refuses every setup step by the licence, and commands identity with nothing", async () => {
      const { caller, commands, ceremony } = await harness({ licensed: false });

      await expect(caller.setArrivals({ ...TARGET, policy: "admit" })).rejects.toMatchObject({
        cause: { code: "sso_license_required" },
      });
      await expect(caller.claimDomain({ ...TARGET, domain: "acme.test" })).rejects.toMatchObject({
        cause: { code: "sso_license_required" },
      });
      expect(commands.setArrivals).not.toHaveBeenCalled();
      expect(ceremony.claimDomain).not.toHaveBeenCalled();
    });
  });

  describe("given a hosted organization nobody opted in", () => {
    /** @scenario "Setting single sign-on up yourself is unavailable until the organization is opted in" */
    /** @scenario "Going live is refused for an organization that may not set single sign-on up" */
    it("refuses by name and offers a conversation, commanding identity with nothing", async () => {
      const { caller, commands, ceremony } = await harness({ isSaas: true });

      await expect(caller.setArrivals({ ...TARGET, policy: "admit" })).rejects.toMatchObject({
        cause: { code: "sso_self_serve_unavailable" },
      });
      await expect(caller.activate(TARGET)).rejects.toMatchObject({
        cause: { code: "sso_self_serve_unavailable" },
      });
      expect(commands.activate).not.toHaveBeenCalled();
      await expect(caller.claimDomain({ ...TARGET, domain: "acme.test" })).rejects.toMatchObject({
        cause: { code: "sso_self_serve_unavailable" },
      });
      expect(commands.setArrivals).not.toHaveBeenCalled();
      expect(ceremony.claimDomain).not.toHaveBeenCalled();
    });
  });

  describe("given a hosted organization opted in to setting up itself", () => {
    it("passes the gate and hands the claim to identity", async () => {
      const { caller, ceremony } = await harness({ isSaas: true, optedIn: ["org_acme"] });

      await caller.claimDomain({ ...TARGET, domain: "acme.test" });

      expect(ceremony.claimDomain).toHaveBeenCalled();
    });

    it("still refuses a hosted organization the opt-in does not name", async () => {
      const { caller, ceremony } = await harness({ isSaas: true, optedIn: ["org_other"] });

      await expect(caller.claimDomain({ ...TARGET, domain: "acme.test" })).rejects.toMatchObject({
        cause: { code: "sso_self_serve_unavailable" },
      });
      expect(ceremony.claimDomain).not.toHaveBeenCalled();
    });
  });

  describe("given an organization whose plan does not carry single sign-on", () => {
    /** @scenario "Registering an identity provider needs an Enterprise plan" */
    /** @scenario "An organization not on an Enterprise plan is told the plan is what refuses" */
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
      ).rejects.toMatchObject({
        cause: { code: "enterprise_plan_required", meta: { feature: "SSO" } },
      });
      expect(commands.register).not.toHaveBeenCalled();
    });

    it("tells a caller without sso:manage that, before it says what the plan lacks", async () => {
      const { caller, commands } = await harness({
        planType: "LAUNCH",
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.activate(TARGET)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(commands.activate).not.toHaveBeenCalled();
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

  describe("given the way back in", () => {
    /** @scenario "The ways back in are listed with who holds them and until when" */
    it("names who holds each grant and when it ends, to a reader who may only look", async () => {
      const { caller, breakGlass } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(
        caller.breakGlassBindings({ organizationId: "org_acme" }),
      ).resolves.toMatchObject([
        { userId: "user_ana", name: "Ana", grantedByName: "Bo", live: true },
      ]);
      expect(breakGlass.findGrants).toHaveBeenCalledWith({ organizationId: "org_acme" });
    });

    /** @scenario "A reader who may not manage single sign-on is offered no grant" */
    it("refuses that same reader the candidates, which only a granter needs", async () => {
      const { caller, breakGlass } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(
        caller.breakGlassCandidates({ organizationId: "org_acme" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(breakGlass.findCandidates).not.toHaveBeenCalled();
    });

    /** @scenario "Granting a way back in names a person and a date" */
    it("names the session administrator as the grantor, never an id from the input", async () => {
      const { caller, breakGlass } = await harness();

      await expect(
        caller.grantBreakGlass({
          organizationId: "org_acme",
          userId: "user_cyd",
          expiresAtMs: 1_766_000_000_000,
        }),
      ).resolves.toMatchObject({ userId: "user_cyd", expiresAtMs: 1_766_000_000_000 });
      expect(breakGlass.grant).toHaveBeenCalledWith({
        organizationId: "org_acme",
        userId: "user_cyd",
        expiresAtMs: 1_766_000_000_000,
        actor: { userId: "user_ana" },
      });
    });

    /** @scenario "A lapsed subscription does not take the way back in away" */
    it("grants one on a lapsed plan, because that is the morning it is for", async () => {
      const { caller, breakGlass } = await harness({ planType: "LAUNCH" });

      await expect(
        caller.grantBreakGlass({
          organizationId: "org_acme",
          userId: "user_cyd",
          expiresAtMs: 1_766_000_000_000,
        }),
      ).resolves.toMatchObject({ userId: "user_cyd" });
      expect(breakGlass.grant).toHaveBeenCalledTimes(1);
    });

    /** @scenario "A way back in can be extended before it ends" */
    it("answers both rows of a renewal, so the date it previously ended stays readable", async () => {
      const { caller } = await harness();

      await expect(
        caller.renewBreakGlass({
          organizationId: "org_acme",
          bindingId: "bgb_1",
          expiresAtMs: 1_768_000_000_000,
        }),
      ).resolves.toMatchObject({
        renewed: { expiresAtMs: 1_768_000_000_000, renewedFromBindingId: "bgb_1" },
        replaced: { bindingId: "bgb_1", supersededAtMs: 1_764_000_000_000 },
      });
    });

    /** @scenario "A way back in can be ended on purpose" */
    it("records the attempt before ending one, so a refusal is still on the trail", async () => {
      const { auditLog, breakGlass, caller } = await harness();
      breakGlass.revoke.mockRejectedValueOnce(new Error("the last way in"));

      await expect(
        caller.revokeBreakGlass({ organizationId: "org_acme", bindingId: "bgb_1" }),
      ).rejects.toThrow("the last way in");

      expect(auditLog.record).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        action: "ssoSetup.revokeBreakGlass",
        args: { organizationId: "org_acme", bindingId: "bgb_1" },
        targetKind: "ssoConnection",
      });
    });

    it("refuses a reader who may see single sign-on to grant, renew or end one", async () => {
      const { breakGlass, caller } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(
        caller.grantBreakGlass({
          organizationId: "org_acme",
          userId: "user_cyd",
          expiresAtMs: 1_766_000_000_000,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.revokeBreakGlass({ organizationId: "org_acme", bindingId: "bgb_1" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(breakGlass.grant).not.toHaveBeenCalled();
      expect(breakGlass.revoke).not.toHaveBeenCalled();
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
