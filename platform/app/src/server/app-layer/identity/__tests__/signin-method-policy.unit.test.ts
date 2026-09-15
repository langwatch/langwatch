import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

// The real license gate, over a stubbed licensing store. What this file has to
// prove is that ADR-027's semantics survive being expressed as method policy,
// and a mocked gate would prove only that the mock was called.
vi.mock("~/env.mjs", () => ({
  env: {
    IS_SAAS: false,
    NEXTAUTH_PROVIDER: "auth0",
    LANGWATCH_LICENSE_KEY: undefined as string | undefined,
    AUTH0_CLIENT_ID: "auth0-client",
    AUTH0_CLIENT_SECRET: "auth0-secret",
    AUTH0_ISSUER: "https://acme.us.auth0.com/",
    NEXTAUTH_URL: "https://acme.test",
    // The schema's own default, restated so the mock is a deployment rather
    // than an accident: passkeys are on unless somebody turns them off.
    PASSKEYS_ENABLED: "on",
    GOOGLE_CLIENT_ID: undefined as string | undefined,
    GOOGLE_CLIENT_SECRET: undefined as string | undefined,
    GITHUB_CLIENT_ID: undefined as string | undefined,
    GITHUB_CLIENT_SECRET: undefined as string | undefined,
    AZURE_AD_CLIENT_ID: undefined as string | undefined,
    AZURE_AD_CLIENT_SECRET: undefined as string | undefined,
    AZURE_AD_TENANT_ID: undefined as string | undefined,
    // The schema's own default: a deployment does not issue its own passwords
    // beside its provider unless somebody says so.
    LOCAL_PASSWORDS_ENABLED: "off",
  },
}));

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock("@langwatch/observability", () => ({ createLogger: () => loggerMock }));

vi.mock("../../../../../ee/licensing/validation", () => ({
  parseLicenseKey: vi.fn(),
  verifySignature: vi.fn(),
  isExpired: vi.fn(),
}));

import {
  __resetSsoGateForTests,
  __setSsoLicenseRepositoryForTests,
} from "@ee/sso/sso-gate";
import { routeSignIn, routingIdentifierOf } from "@langwatch/identity";
import {
  isExpired,
  parseLicenseKey,
  verifySignature,
} from "../../../../../ee/licensing/validation";
import {
  deploymentIsFederationCapable,
  deploymentOffersPasskeys,
  LOCAL_METHOD_SET,
  PASSKEY_METHOD,
  PASSWORD_METHOD,
  resolveSignInMethodPolicy,
} from "../signin-method-policy";

const envMock = (await import("~/env.mjs")).env as unknown as Record<
  string,
  unknown
> & {
  NEXTAUTH_PROVIDER: string;
  IS_SAAS: boolean;
};

/** Credentials for a social provider, present the way a deployment that
 *  configured one has them. Whether better-auth MOUNTS it is a separate
 *  question, and the one several scenarios below turn on. */
function socialCredentials(provider: "google" | "github" | "azure-ad"): void {
  if (provider === "google") {
    envMock.GOOGLE_CLIENT_ID = "google-client";
    envMock.GOOGLE_CLIENT_SECRET = "google-secret";
    return;
  }
  if (provider === "github") {
    envMock.GITHUB_CLIENT_ID = "github-client";
    envMock.GITHUB_CLIENT_SECRET = "github-secret";
    return;
  }
  envMock.AZURE_AD_CLIENT_ID = "azure-client";
  envMock.AZURE_AD_CLIENT_SECRET = "azure-secret";
  envMock.AZURE_AD_TENANT_ID = "azure-tenant";
}

const methodIds = (methods: readonly { id: string }[]): string[] =>
  methods.map((method) => method.id);

const genuineLicense = () => ({
  data: { expiresAt: "2099-01-01", organizationName: "Acme" },
});

function licensedStore(licensed: boolean) {
  __setSsoLicenseRepositoryForTests({
    findOrganizationsWithLicense: vi
      .fn()
      .mockResolvedValue(licensed ? [{ id: "org_1", license: "encoded" }] : []),
  });
  vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense() as never);
  vi.mocked(verifySignature).mockReturnValue(licensed);
  vi.mocked(isExpired).mockReturnValue(false);
}

describe("the instance sign-in method policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSsoGateForTests();
    envMock.NEXTAUTH_PROVIDER = "auth0";
    envMock.IS_SAAS = false;
    envMock.PASSKEYS_ENABLED = "on";
    envMock.LOCAL_PASSWORDS_ENABLED = "off";
    for (const key of [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "AZURE_AD_CLIENT_ID",
      "AZURE_AD_CLIENT_SECRET",
      "AZURE_AD_TENANT_ID",
    ]) {
      envMock[key] = undefined;
    }
  });

  describe("given a self-hosted installation configured with a single OAuth provider", () => {
    beforeEach(() => {
      licensedStore(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    it("makes the configured provider the offered method, exactly as before", async () => {
      const policy = await resolveSignInMethodPolicy();

      expect(policy.defaultMethods).toEqual([
        { id: "auth0", kind: "federated", connectionId: null },
        PASSKEY_METHOD,
      ]);
      expect(policy.federationLicensed).toBe(true);
      expect(policy.selfHosted).toBe(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    it("ends nothing when a second method joins the set", async () => {
      const policy = await resolveSignInMethodPolicy();
      const withPasskey = {
        ...policy,
        defaultMethods: [
          ...policy.defaultMethods,
          { id: "passkey", kind: "passkey" as const, connectionId: null },
        ],
      };

      const decision = routeSignIn({
        identifier: null,
        breakGlass: false,
        policy: withPasskey,
        domainConnection: null,
        activeConnections: [],
      });

      // The first method is still there, and still offered: a method set is
      // additive, which is the entire difference from a global one-provider
      // invariant.
      expect(decision.methodSet).toEqual(withPasskey.defaultMethods);
      expect(decision.methodSet[0]).toEqual({
        id: "auth0",
        kind: "federated",
        connectionId: null,
      });
    });
  });

  describe("given a self-hosted installation whose license gate denies", () => {
    beforeEach(() => {
      licensedStore(false);
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("offers the email and password method set and no federated one", async () => {
      const policy = await resolveSignInMethodPolicy();

      expect(policy.federationLicensed).toBe(false);
      expect(policy.defaultMethods).toEqual([PASSWORD_METHOD, PASSKEY_METHOD]);
      expect(policy.localMethods).toEqual(LOCAL_METHOD_SET);
      expect(
        policy.defaultMethods.some((method) => method.kind === "federated"),
      ).toBe(false);
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("keeps every federated method out of the routing decision too", async () => {
      const policy = await resolveSignInMethodPolicy();

      const decision = routeSignIn({
        identifier: null,
        breakGlass: false,
        policy,
        domainConnection: null,
        activeConnections: [],
      });

      expect(decision.outcome).toBe("method_picker");
      expect(decision.methodSet).toEqual([PASSWORD_METHOD, PASSKEY_METHOD]);
    });
  });

  describe("when a license is activated mid-process", () => {
    /** @scenario "The license gate still freezes at startup" */
    it("does not change routing decisions until the next restart", async () => {
      const findOrganizationsWithLicense = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "org_1", license: "encoded" }]);
      __setSsoLicenseRepositoryForTests({ findOrganizationsWithLicense });

      const atStartup = await resolveSignInMethodPolicy();
      expect(atStartup.federationLicensed).toBe(false);

      // The license lands in the database, signature and all.
      vi.mocked(parseLicenseKey).mockReturnValue(genuineLicense() as never);
      vi.mocked(verifySignature).mockReturnValue(true);
      vi.mocked(isExpired).mockReturnValue(false);

      const sameProcess = await resolveSignInMethodPolicy();
      expect(sameProcess.federationLicensed).toBe(false);
      expect(sameProcess.defaultMethods).toEqual(atStartup.defaultMethods);
      expect(findOrganizationsWithLicense).toHaveBeenCalledTimes(1);

      // A restart, and only a restart, re-decides.
      __resetSsoGateForTests();
      __setSsoLicenseRepositoryForTests({ findOrganizationsWithLicense });
      const afterRestart = await resolveSignInMethodPolicy();
      expect(afterRestart.federationLicensed).toBe(true);
    });
  });

  describe("given a self-hosted installation that mounted a social identity provider", () => {
    beforeEach(() => {
      licensedStore(true);
    });

    /** @scenario "Every social provider this deployment mounted is offered by name" */
    it("offers that provider under the id the sign-in call dials", async () => {
      envMock.NEXTAUTH_PROVIDER = "google";
      socialCredentials("google");

      const policy = await resolveSignInMethodPolicy();

      expect(policy.defaultMethods).toEqual([
        { id: "google", kind: "federated", connectionId: null },
        PASSKEY_METHOD,
      ]);
    });

    /*
     * better-auth registers Microsoft under `microsoft`; everything outside it
     * — the env value, the Account rows, the callback path Azure has
     * registered, the label — calls the same provider `azure-ad`. Both names
     * reach the policy, and the rail must draw one button.
     */
    /** @scenario "Every social provider this deployment mounted is offered by name" */
    it("offers a provider named two ways exactly once", async () => {
      envMock.NEXTAUTH_PROVIDER = "azure-ad";
      socialCredentials("azure-ad");

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual(["azure-ad", "passkey"]);
      expect(methodIds(policy.defaultMethods)).not.toContain("microsoft");
    });
  });

  describe("when credentials are present for several social providers", () => {
    beforeEach(() => {
      licensedStore(true);
    });

    /** @scenario "Social providers mount on their credentials, not on the provider env" */
    it("offers every social provider whose credentials are present", async () => {
      // Credentials ARE the mounting decision now (D09): the Auth0-broker
      // migration needs the native providers mounted beside the one
      // `NEXTAUTH_PROVIDER` names, and an operator sets a client id and
      // secret for no reason other than to offer that provider.
      envMock.NEXTAUTH_PROVIDER = "google";
      socialCredentials("google");
      socialCredentials("github");

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toContain("google");
      expect(methodIds(policy.defaultMethods)).toContain("github");
    });

    /** @scenario "Social providers mount on their credentials, not on the provider env" */
    it("still never offers a provider whose credentials are absent", async () => {
      envMock.NEXTAUTH_PROVIDER = "google";
      socialCredentials("google");

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toContain("google");
      expect(methodIds(policy.defaultMethods)).not.toContain("github");
      expect(methodIds(policy.defaultMethods)).not.toContain("gitlab");
    });

    /** @scenario "SaaS shows the broker's social connections as their own buttons" */
    it("offers the branded bridge methods ahead of the generic one on SaaS", async () => {
      envMock.IS_SAAS = true;

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual([
        "auth0-google",
        "auth0-github",
        "auth0-microsoft",
        "auth0",
        "passkey",
      ]);
    });

    /** @scenario "SaaS shows the broker's social connections as their own buttons" */
    it("keeps a self-hosted Auth0 deployment on the generic method alone", async () => {
      envMock.IS_SAAS = false;

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual(["auth0", "passkey"]);
    });

    /** @scenario "A natively mounted provider takes over its own bridge button" */
    it("draws one Google button when the native client is mounted beside the bridge", async () => {
      // The cutover: the Google credentials land, and the bridge button for
      // Google steps aside for the native one rather than standing beside it.
      // Two buttons both reading "Continue with Google" is the failure this
      // prevents — nothing on either would tell a person which is theirs.
      envMock.IS_SAAS = true;
      socialCredentials("google");

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual([
        "google",
        "auth0-github",
        "auth0-microsoft",
        "auth0",
        "passkey",
      ]);
    });

    /** @scenario "A natively mounted provider takes over its own bridge button" */
    it("cuts providers over one at a time, leaving the rest brokered", async () => {
      envMock.IS_SAAS = true;
      socialCredentials("google");
      socialCredentials("azure-ad");

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual([
        "google",
        "auth0-github",
        "azure-ad",
        "auth0",
        "passkey",
      ]);
    });

    /** @scenario "Social providers mount on their credentials, not on the provider env" */
    it("mounts and offers nothing in email mode, whatever credentials linger", async () => {
      // Email mode is exactly what ADR-027 means by DENY, and the federation
      // request hook stands down entirely there — a provider mounted in email
      // mode would be a live, license-ungated sign-in endpoint.
      envMock.NEXTAUTH_PROVIDER = "email";
      socialCredentials("google");

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual(["password", "passkey"]);
    });

    /** @scenario "Social providers mount on their credentials, not on the provider env" */
    it("keeps the password offered when the named provider is a typo", async () => {
      // The typo coerces to email mode; a stray credential's social method
      // must not overrule that landing — a federated method in the default
      // set is the exact predicate that 403s the password and reset routes.
      envMock.NEXTAUTH_PROVIDER = "gogle";
      socialCredentials("github");

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual(["password", "passkey"]);
    });

    /** @scenario "A social provider this deployment never mounted is never offered" */
    it("never offers a provider whose credentials are incomplete", async () => {
      envMock.NEXTAUTH_PROVIDER = "google";
      socialCredentials("google");
      // Two of azure-ad's three values: better-auth is never handed the
      // provider, so no button may dial it.
      envMock.AZURE_AD_CLIENT_ID = "azure-client";
      envMock.AZURE_AD_CLIENT_SECRET = "azure-secret";

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toContain("google");
      expect(methodIds(policy.defaultMethods)).not.toContain("azure-ad");
    });
  });

  describe("when the deployment issues its own passwords beside its provider", () => {
    beforeEach(() => {
      licensedStore(true);
      envMock.LOCAL_PASSWORDS_ENABLED = "on";
    });

    /** @scenario "A deployment that issues its own passwords offers one beside its provider" */
    it("offers the password behind the federated methods, which still lead", async () => {
      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual([
        "auth0",
        "password",
        "passkey",
      ]);
      expect(policy.defaultMethods[0]).toEqual({
        id: "auth0",
        kind: "federated",
        connectionId: null,
      });
    });

    /** @scenario "A deployment that issues its own passwords offers one beside its provider" */
    it("offers no password beside them when the deployment does not issue its own", async () => {
      envMock.LOCAL_PASSWORDS_ENABLED = "off";

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual(["auth0", "passkey"]);
    });

    /** @scenario "A deployment that issues its own passwords offers one beside its provider" */
    it("keeps the branded bridge buttons ahead of the password on SaaS", async () => {
      envMock.IS_SAAS = true;

      const policy = await resolveSignInMethodPolicy();

      expect(methodIds(policy.defaultMethods)).toEqual([
        "auth0-google",
        "auth0-github",
        "auth0-microsoft",
        "auth0",
        "password",
        "passkey",
      ]);
    });

    /** @scenario "The credential routes answer on a deployment that offers a password" */
    it("ranks a password the account holds, which is what lets it be offered back", async () => {
      const policy = await resolveSignInMethodPolicy();

      const decision = routeSignIn({
        identifier: routingIdentifierOf("sam@home.net"),
        breakGlass: false,
        policy,
        domainConnection: null,
        activeConnections: [],
        // An account holding a password and nothing else. `rankAccountMethods`
        // intersects what it holds with the offered set, so this is the
        // assertion the switch is really for: a password missing from the
        // policy is a password nobody holding one can be routed to, and
        // passing no account at all would only re-check the default picker.
        account: {
          hasPassword: true,
          hasPasskey: false,
          providerIds: [],
          connectionIds: [],
        },
      });

      expect(methodIds(decision.methodSet)).toEqual(["password"]);
    });
  });

  describe("when a social provider is mounted but the license gate denies", () => {
    beforeEach(() => {
      licensedStore(false);
    });

    /** @scenario "A never-licensed installation offers no social provider either" */
    it("offers the local method set and no social provider", async () => {
      envMock.NEXTAUTH_PROVIDER = "google";
      socialCredentials("google");

      const policy = await resolveSignInMethodPolicy();

      expect(policy.federationLicensed).toBe(false);
      expect(policy.defaultMethods).toEqual([PASSWORD_METHOD, PASSKEY_METHOD]);
      expect(methodIds(policy.defaultMethods)).not.toContain("google");
    });
  });

  describe("when the operator has turned passkeys off", () => {
    beforeEach(() => {
      licensedStore(true);
      envMock.PASSKEYS_ENABLED = "off";
    });

    /** @scenario "An operator can turn passkeys off for the whole deployment" */
    it("offers no passkey in any method set", async () => {
      const policy = await resolveSignInMethodPolicy();

      expect(deploymentOffersPasskeys()).toBe(false);
      expect(policy.defaultMethods).toEqual([
        { id: "auth0", kind: "federated", connectionId: null },
      ]);
      expect(policy.localMethods).toEqual(LOCAL_METHOD_SET);
    });

    /** @scenario "An operator can turn passkeys off for the whole deployment" */
    it("keeps the passkey out of the routing decision too", async () => {
      envMock.NEXTAUTH_PROVIDER = "email";
      const policy = await resolveSignInMethodPolicy();

      const decision = routeSignIn({
        identifier: null,
        breakGlass: false,
        policy,
        domainConnection: null,
        activeConnections: [],
      });

      expect(decision.methodSet).toEqual([PASSWORD_METHOD]);
    });
  });

  describe("when the deployment has said nothing about passkeys", () => {
    /** @scenario "A passkey is offered on every deployment, not on some of them" */
    it("offers them, because the setting is for turning them off", async () => {
      licensedStore(true);
      // What the env schema resolves an unset value to. Absence is the
      // ordinary state and it has to mean "offered".
      envMock.PASSKEYS_ENABLED = "on";

      const policy = await resolveSignInMethodPolicy();

      expect(deploymentOffersPasskeys()).toBe(true);
      expect(policy.defaultMethods).toContainEqual(PASSKEY_METHOD);
    });
  });

  describe("when the deployment names no federated method at all", () => {
    it("answers the capability question without waiting on the licensing store", () => {
      envMock.NEXTAUTH_PROVIDER = "email";
      const store = vi.fn();
      __setSsoLicenseRepositoryForTests({
        findOrganizationsWithLicense: store,
      });

      // Synchronous by contract: the before-hook must be able to leave an
      // email-mode deployment alone without a store read in the way.
      expect(deploymentIsFederationCapable()).toBe(false);
      expect(store).not.toHaveBeenCalled();
    });
  });
});
