import {
  emptyIdentityHeads,
  type IdentifierFact,
  routeSignIn,
  routingIdentifierOf,
  type SignInMethod,
} from "@langwatch/identity";
import type {
  IdentityHeadsRepository,
  IdentityUserGate,
} from "@langwatch/identity-server";
import { describe, expect, it } from "vitest";
import {
  type LegacySignInAccount,
  type LegacySignInAccountDirectory,
  ProjectionSignInAccountLookup,
} from "../signin-account-lookup";

const EMAIL = "legacy@home.net";
const USER_ID = "user_legacy";
const PASSWORD: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};
const PASSKEY: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};
const AUTH0: SignInMethod = {
  id: "auth0",
  kind: "federated",
  connectionId: null,
};

class FakeHeads implements IdentityHeadsRepository {
  constructor(
    private readonly holder: {
      userId: string;
      identifierId: string;
    } | null = null,
    private readonly identifiers: Record<string, IdentifierFact> = {},
  ) {}

  async findUserHashKey(): Promise<string | null> {
    return null;
  }

  async hasFolded(): Promise<boolean> {
    return true;
  }

  async findHeads({ userId }: { userId: string }) {
    return { ...emptyIdentityHeads({ userId }), identifiers: this.identifiers };
  }

  async findActiveIdentifierByValue(): Promise<{
    userId: string;
    identifierId: string;
  } | null> {
    return this.holder;
  }

  async findIdentifier(): Promise<IdentifierFact | null> {
    return null;
  }

  async findIdentifierIdForAccount(): Promise<string | null> {
    return null;
  }
}

class FakeLegacyDirectory implements LegacySignInAccountDirectory {
  constructor(private readonly account: LegacySignInAccount | null) {}

  async findLegacySignInAccount(): Promise<LegacySignInAccount | null> {
    return this.account;
  }
}

function legacyAccount({
  methods = {},
  auth0Subjects = [],
}: {
  methods?: Partial<LegacySignInAccount["methods"]>;
  auth0Subjects?: readonly string[];
} = {}): LegacySignInAccount {
  return {
    userId: USER_ID,
    methods: {
      hasPassword: false,
      hasPasskey: false,
      providerIds: [],
      connectionIds: [],
      ...methods,
    },
    auth0Subjects,
  };
}

function build({
  account = null,
  latched = false,
  projectedHolder = null,
  identifiers = {},
  auth0Bridge = false,
  mountedSocialMethodIds = [],
}: {
  account?: LegacySignInAccount | null;
  latched?: boolean;
  projectedHolder?: { userId: string; identifierId: string } | null;
  identifiers?: Record<string, IdentifierFact>;
  auth0Bridge?: boolean;
  mountedSocialMethodIds?: readonly string[];
} = {}) {
  const isLatched: IdentityUserGate = async () => latched;
  return new ProjectionSignInAccountLookup({
    heads: new FakeHeads(projectedHolder, identifiers),
    legacy: new FakeLegacyDirectory(account),
    isLatched,
    auth0BridgeIsActive: auth0Bridge,
    mountedSocialMethodIds,
  });
}

async function routeLegacyAccount({
  account,
  methods,
}: {
  account: LegacySignInAccount | null;
  methods: readonly SignInMethod[];
}) {
  return await routeAccount({ lookup: build({ account }), methods });
}

async function routeAccount({
  lookup,
  methods,
}: {
  lookup: ProjectionSignInAccountLookup;
  methods: readonly SignInMethod[];
}) {
  const methodsForAccount = await lookup.findAccountMethods({
    normalizedValue: EMAIL,
  });

  return routeSignIn({
    identifier: routingIdentifierOf(EMAIL),
    breakGlass: false,
    policy: {
      defaultMethods: methods,
      localMethods: [PASSWORD],
      federationLicensed: true,
      selfHosted: false,
    },
    domainConnection: null,
    activeConnections: [],
    account: methodsForAccount,
  });
}

describe("ProjectionSignInAccountLookup legacy fallback", () => {
  /** @scenario "An unlatched legacy account with a password offers password sign-in" */
  /** @scenario "An account the sign-up form just made is not mistaken for no account" */
  it("offers the password held by an unlatched account", async () => {
    const decision = await routeLegacyAccount({
      account: legacyAccount({ methods: { hasPassword: true } }),
      methods: [PASSWORD, PASSKEY],
    });

    expect(decision).toMatchObject({
      outcome: "method_picker",
      methodSet: [PASSWORD],
      reasonCode: "account_methods",
    });
  });

  it("keeps Auth0 alongside a passkey for an unlatched account without an SSO domain", async () => {
    const decision = await routeLegacyAccount({
      account: legacyAccount({
        methods: { hasPasskey: true, providerIds: ["auth0"] },
      }),
      methods: [AUTH0, PASSKEY],
    });

    expect(decision).toMatchObject({
      outcome: "method_picker",
      methodSet: [PASSKEY, AUTH0],
      reasonCode: "account_methods",
    });
  });

  it("keeps Auth0 alongside a passkey after the account latches", async () => {
    const auth0: IdentifierFact = {
      identifierId: "identifier_auth0",
      userId: USER_ID,
      provider: "oidc",
      value: EMAIL,
      domain: "home.net",
      identifierHash: null,
      accountId: "account_auth0",
      providerId: "auth0",
      issuer: "auth0",
      providerAccountId: "auth0_subject",
      connectionId: null,
      state: "VERIFIED",
      verifiedAtMs: 1_690_000_000_000,
      attachedAtMs: 1_690_000_000_000,
      detachedAtMs: null,
    };
    const passkey: IdentifierFact = {
      identifierId: "identifier_passkey",
      userId: USER_ID,
      provider: "passkey",
      value: "credential_abc",
      domain: null,
      identifierHash: null,
      accountId: "account_passkey",
      providerId: "passkey",
      issuer: "local:passkey",
      providerAccountId: "credential_abc",
      connectionId: null,
      state: "VERIFIED",
      verifiedAtMs: 1_690_000_000_000,
      attachedAtMs: 1_690_000_000_000,
      detachedAtMs: null,
    };
    const lookup = build({
      latched: true,
      projectedHolder: { userId: USER_ID, identifierId: auth0.identifierId },
      identifiers: {
        [auth0.identifierId]: auth0,
        [passkey.identifierId]: passkey,
      },
    });

    const decision = await routeAccount({ lookup, methods: [AUTH0, PASSKEY] });

    expect(decision).toMatchObject({
      outcome: "method_picker",
      methodSet: [PASSKEY, AUTH0],
      reasonCode: "account_methods",
    });
  });

  it("offers a passkey held by an unlatched account", async () => {
    const decision = await routeLegacyAccount({
      account: legacyAccount({ methods: { hasPasskey: true } }),
      methods: [PASSWORD, PASSKEY],
    });

    expect(decision).toMatchObject({
      outcome: "method_picker",
      methodSet: [PASSKEY],
      reasonCode: "account_methods",
    });
  });

  it("routes a truly unknown address to sign-up", async () => {
    const decision = await routeLegacyAccount({
      account: null,
      methods: [PASSWORD, PASSKEY],
    });

    expect(decision).toMatchObject({
      outcome: "route_to_signup",
      methodSet: [],
      reasonCode: "identifier_unknown",
    });
  });

  it("does not use legacy rows after the identifier migration latches", async () => {
    const lookup = build({
      account: legacyAccount({ methods: { hasPassword: true } }),
      latched: true,
    });

    await expect(
      lookup.findAccountMethods({ normalizedValue: EMAIL }),
    ).resolves.toBeNull();
  });

  describe("when the Auth0 connection bridge is active", () => {
    const AUTH0_GOOGLE: SignInMethod = {
      id: "auth0-google",
      kind: "federated",
      connectionId: null,
    };
    const BRIDGE_METHODS = [AUTH0_GOOGLE, AUTH0];

    /** @scenario "An account brokered through a social connection routes to its own button" */
    it("redirects an unlatched Google-through-Auth0 account to the branded method", async () => {
      const lookup = build({
        account: legacyAccount({
          methods: { providerIds: ["auth0"] },
          auth0Subjects: ["google-oauth2|107698336211125"],
        }),
        auth0Bridge: true,
      });

      const decision = await routeAccount({ lookup, methods: BRIDGE_METHODS });

      expect(decision).toMatchObject({
        outcome: "redirect_to_connection",
        methodSet: [AUTH0_GOOGLE],
        reasonCode: "account_methods",
      });
    });

    /** @scenario "An account brokered through a social connection routes to its own button" */
    it("keeps the broker's own database users on the generic method", async () => {
      const lookup = build({
        account: legacyAccount({
          methods: { providerIds: ["auth0"] },
          auth0Subjects: ["auth0|64f1c9"],
        }),
        auth0Bridge: true,
      });

      const decision = await routeAccount({ lookup, methods: BRIDGE_METHODS });

      expect(decision).toMatchObject({
        outcome: "redirect_to_connection",
        methodSet: [AUTH0],
        reasonCode: "account_methods",
      });
    });

    it("routes a latched account's brokered subject the same way", async () => {
      const googleThroughAuth0: IdentifierFact = {
        identifierId: "identifier_auth0",
        userId: USER_ID,
        provider: "oidc",
        value: EMAIL,
        domain: "home.net",
        identifierHash: null,
        accountId: "account_auth0",
        providerId: "auth0",
        issuer: "local:oauth:auth0",
        providerAccountId: "google-oauth2|107698336211125",
        connectionId: null,
        state: "VERIFIED",
        verifiedAtMs: 1_690_000_000_000,
        attachedAtMs: 1_690_000_000_000,
        detachedAtMs: null,
      };
      const lookup = build({
        latched: true,
        projectedHolder: {
          userId: USER_ID,
          identifierId: googleThroughAuth0.identifierId,
        },
        identifiers: {
          [googleThroughAuth0.identifierId]: googleThroughAuth0,
        },
        auth0Bridge: true,
      });

      await expect(
        lookup.findAccountMethods({ normalizedValue: EMAIL }),
      ).resolves.toMatchObject({ providerIds: ["auth0-google"] });
    });

    /** @scenario "A natively mounted provider takes over its own bridge button" */
    it("routes a brokered account to the native method once that provider is mounted", async () => {
      // The cutover for one provider. Ranking intersects the account's
      // methods with the rail, and the rail now draws `google` — answering
      // `auth0-google` here would match nothing and drop this person onto the
      // generic picker.
      const lookup = build({
        account: legacyAccount({
          methods: { providerIds: ["auth0"] },
          auth0Subjects: ["google-oauth2|107698336211125"],
        }),
        auth0Bridge: true,
        mountedSocialMethodIds: ["google"],
      });

      const decision = await routeAccount({
        lookup,
        methods: [
          { id: "google", kind: "federated", connectionId: null },
          AUTH0,
        ],
      });

      expect(decision).toMatchObject({
        outcome: "redirect_to_connection",
        methodSet: [{ id: "google", kind: "federated", connectionId: null }],
        reasonCode: "account_methods",
      });
    });

    /** @scenario "A natively mounted provider takes over its own bridge button" */
    it("leaves a provider that was not cut over on its bridge method", async () => {
      const lookup = build({
        account: legacyAccount({
          methods: { providerIds: ["auth0"] },
          auth0Subjects: ["github|839161"],
        }),
        auth0Bridge: true,
        mountedSocialMethodIds: ["google"],
      });

      await expect(
        lookup.findAccountMethods({ normalizedValue: EMAIL }),
      ).resolves.toMatchObject({ providerIds: ["auth0-github"] });
    });

    it("changes nothing while the bridge is inactive", async () => {
      const lookup = build({
        account: legacyAccount({
          methods: { providerIds: ["auth0"] },
          auth0Subjects: ["google-oauth2|107698336211125"],
        }),
      });

      await expect(
        lookup.findAccountMethods({ normalizedValue: EMAIL }),
      ).resolves.toMatchObject({ providerIds: ["auth0"] });
    });
  });

  it("uses legacy methods when an unlatched account has partial identifier heads", async () => {
    const partialCredential: IdentifierFact = {
      identifierId: "identifier_partial",
      userId: USER_ID,
      provider: "credential",
      value: EMAIL,
      domain: "home.net",
      identifierHash: null,
      accountId: "account_placeholder",
      providerId: "credential",
      issuer: "local:credential",
      providerAccountId: USER_ID,
      connectionId: null,
      state: "VERIFIED",
      verifiedAtMs: 1_690_000_000_000,
      attachedAtMs: 1_690_000_000_000,
      detachedAtMs: null,
    };
    const lookup = build({
      account: legacyAccount({ methods: { hasPasskey: true } }),
      projectedHolder: {
        userId: USER_ID,
        identifierId: partialCredential.identifierId,
      },
      identifiers: { [partialCredential.identifierId]: partialCredential },
    });

    await expect(
      lookup.findAccountMethods({ normalizedValue: EMAIL }),
    ).resolves.toEqual({
      hasPassword: false,
      hasPasskey: true,
      providerIds: [],
      connectionIds: [],
    });
  });
});
