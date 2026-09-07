import type {
  AccountSignInMethods,
  RoutableConnection,
  SignInMethod,
  SignInMethodPolicy,
} from "@langwatch/identity";
import { SignInRouterService } from "@langwatch/identity-server";
import { describe, expect, it } from "vitest";
import { decideLocalSignUp } from "../runtime";

const password: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};
const passkey: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};
const okta: SignInMethod = {
  id: "okta",
  kind: "federated",
  connectionId: "conn_acme",
};
const active: RoutableConnection = {
  connectionId: "conn_acme",
  method: okta,
  state: "ACTIVE",
  configured: true,
  allowsJit: true,
};
const policy: SignInMethodPolicy = {
  defaultMethods: [password, passkey],
  localMethods: [password],
  federationLicensed: true,
  selfHosted: true,
};

function fixture({
  byDomain = null,
  activeConnections = [],
  routingAccount = null,
  exactUserId = null,
  currentPolicy = policy,
  passwordAllowed = true,
}: {
  byDomain?: RoutableConnection | null;
  activeConnections?: readonly RoutableConnection[];
  routingAccount?: AccountSignInMethods | null;
  exactUserId?: string | null;
  currentPolicy?: SignInMethodPolicy;
  passwordAllowed?: boolean;
} = {}) {
  const router = new SignInRouterService({
    domains: {
      findConnectionForDomain: async () => byDomain,
      listActiveConnections: async () => activeConnections,
    },
    policy: { resolvePolicy: async () => currentPolicy },
    breakGlass: { allow: async () => false },
    accounts: { findAccountMethods: async () => routingAccount },
  });

  return (email = "sam@example.com") =>
    decideLocalSignUp(email, {
      router,
      findUserIdByEmail: async () => exactUserId,
      resolveDefaultMethods: async () => currentPolicy.defaultMethods,
      passwordIsAllowed: async () => passwordAllowed,
    });
}

describe("decideLocalSignUp", () => {
  it("allows an unknown outside-domain address on a sole-SSO installation", async () => {
    await expect(
      fixture({ activeConnections: [active] })(),
    ).resolves.toMatchObject({
      outcome: "enroll",
      methodSet: [password, passkey],
    });
  });

  it("keeps the router's local fallback when federation is unlicensed", async () => {
    await expect(
      fixture({
        byDomain: active,
        currentPolicy: { ...policy, federationLicensed: false },
      })("sam@acme.com"),
    ).resolves.toMatchObject({ outcome: "enroll", methodSet: [password] });
  });

  it("redirects a domain governed by a licensed active connection", async () => {
    await expect(
      fixture({ byDomain: active })("sam@acme.com"),
    ).resolves.toMatchObject({
      outcome: "redirect",
      methodSet: [okta],
    });
  });

  it("does not adopt an existing account into a new enrollment", async () => {
    await expect(
      fixture({
        exactUserId: "user_existing",
        routingAccount: {
          hasPassword: true,
          hasPasskey: false,
          providerIds: [],
          connectionIds: [],
        },
      })(),
    ).resolves.toMatchObject({ outcome: "existing_account", methodSet: [] });
  });

  it("refuses enrollment while the address's connection is suspended", async () => {
    await expect(
      fixture({ byDomain: { ...active, state: "SUSPENDED" } })("sam@acme.com"),
    ).resolves.toMatchObject({ outcome: "unavailable", methodSet: [] });
  });

  it("does not offer password when the deployment-wide provider guard denies it", async () => {
    await expect(
      fixture({
        byDomain: { ...active, configured: false },
        passwordAllowed: false,
      })("sam@acme.com"),
    ).resolves.toMatchObject({ outcome: "unavailable", methodSet: [] });
  });
});
