import {
  emptyIdentityHeads,
  type IdentifierFact,
  routeSignIn,
  routingIdentifierOf,
  type SignInMethod,
} from "@langwatch/identity";
import type { IdentityHeadsRepository, IdentityUserGate } from "@langwatch/identity-server";
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

function legacyAccount(
  overrides: Partial<LegacySignInAccount["methods"]> = {},
): LegacySignInAccount {
  return {
    userId: USER_ID,
    methods: {
      hasPassword: false,
      hasPasskey: false,
      connectionIds: [],
      ...overrides,
    },
  };
}

function build({
  account = null,
  latched = false,
  projectedHolder = null,
  identifiers = {},
}: {
  account?: LegacySignInAccount | null;
  latched?: boolean;
  projectedHolder?: { userId: string; identifierId: string } | null;
  identifiers?: Record<string, IdentifierFact>;
} = {}) {
  const isLatched: IdentityUserGate = async () => latched;
  return new ProjectionSignInAccountLookup(
    new FakeHeads(projectedHolder, identifiers),
    new FakeLegacyDirectory(account),
    isLatched,
  );
}

async function routeLegacyAccount({
  account,
  methods,
}: {
  account: LegacySignInAccount | null;
  methods: readonly SignInMethod[];
}) {
  const methodsForAccount = await build({ account }).findAccountMethods({
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
  /** @scenario "An account still waiting for identifier backfill keeps its way in" */
  it("offers the password held by an unlatched account", async () => {
    const decision = await routeLegacyAccount({
      account: legacyAccount({ hasPassword: true }),
      methods: [PASSWORD, PASSKEY],
    });

    expect(decision).toMatchObject({
      outcome: "method_picker",
      methodSet: [PASSWORD],
      reasonCode: "account_methods",
    });
  });

  it("keeps an unlatched Auth0 account on the configured provider without an SSO domain", async () => {
    const decision = await routeLegacyAccount({
      account: legacyAccount(),
      methods: [AUTH0, PASSKEY],
    });

    expect(decision).toMatchObject({
      outcome: "method_picker",
      methodSet: [AUTH0, PASSKEY],
      reasonCode: "no_domain_match",
    });
  });

  it("offers a passkey held by an unlatched account", async () => {
    const decision = await routeLegacyAccount({
      account: legacyAccount({ hasPasskey: true }),
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
      account: legacyAccount({ hasPassword: true }),
      latched: true,
    });

    await expect(lookup.findAccountMethods({ normalizedValue: EMAIL })).resolves.toBeNull();
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
      account: legacyAccount({ hasPasskey: true }),
      projectedHolder: {
        userId: USER_ID,
        identifierId: partialCredential.identifierId,
      },
      identifiers: { [partialCredential.identifierId]: partialCredential },
    });

    await expect(lookup.findAccountMethods({ normalizedValue: EMAIL })).resolves.toEqual({
      hasPassword: false,
      hasPasskey: true,
      connectionIds: [],
    });
  });
});
