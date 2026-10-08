/**
 * The signup form's door auth now owns (D-A1U-2), over user and organization stubs.
 * @see specs/licensing/sso-license-gating.feature
 * @see modules/auth/specs/sign-up.feature
 */
import { type AuthApi, InvalidAuthOriginError } from "@langwatch/auth-contract";
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { RegisterCredentialAccountInput, UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { CredentialRegistrationService } from "../credential-registration.service.ts";

const PASSWORD: SignInMethod = { id: "password", kind: "password", connectionId: null };
const PASSKEY: SignInMethod = { id: "passkey", kind: "passkey", connectionId: null };
const OPEN: RoutingDecision = {
  outcome: "route_to_signup",
  methodSet: [],
  reasonCode: "no_domain_match",
};
const GOVERNED: RoutingDecision = {
  outcome: "redirect_to_connection",
  connectionId: "conn-1",
  methodSet: [{ id: "okta", kind: "federated", connectionId: "conn-1" }],
  reasonCode: "domain_routed",
};

function doors({
  provider = "email",
  localPasswords = false,
  allowed = true,
  routing = OPEN,
  proof = "confirmed",
  taken = false,
  defaultMethods = [PASSWORD],
}: {
  taken?: boolean;
  defaultMethods?: readonly SignInMethod[];
  provider?: string;
  localPasswords?: boolean;
  allowed?: boolean;
  routing?: RoutingDecision;
  proof?: "confirmed" | "unconfirmed" | "refused";
} = {}) {
  const users = {
    registerCredentialAccount: vi.fn<UserApi["registerCredentialAccount"]>(async () => ({
      id: "user-1",
    })),
  };
  const organizations = {
    checkSignUp: vi.fn<OrganizationApi["checkSignUp"]>(async () => ({
      allowed: true,
      via: "open",
    })),
  };
  const auth = {
    assertSignUpOrigin: vi.fn<AuthApi["assertSignUpOrigin"]>(async () => undefined),
    resolveAuthProvider: vi.fn(async () => provider),
    route: vi.fn(async () => routing),
    isWithinBudget: vi.fn(async () => ({ allowed, retryAfterSeconds: allowed ? undefined : 1200 })),
    addressIsRegistered: vi.fn(async () => taken),
    claimSignUpAddressProof: vi.fn(async () => proof === "confirmed"),
    claimUnconfirmedSignUpAddressProof: vi.fn(async () => proof === "unconfirmed"),
  };
  const service = CredentialRegistrationService.create({
    users,
    organizations,
    auth,
    issuesOwnPasswords: () => localPasswords,
    resolveDefaultMethods: vi.fn(async () => defaultMethods),
  });

  return { users, organizations, auth, service };
}

function signUp(overrides: Partial<RegisterCredentialAccountInput> = {}) {
  return {
    name: "Alice",
    email: "a@x.com",
    password: "supersecret",
    addressProof: "address-proof",
    callerAddress: "127.0.0.1",
    origin: "http://localhost:5560",
    referer: null,
    ...overrides,
  };
}

describe("registering through auth's door", () => {
  describe("when the address proof was spent", () => {
    it("has user mint the lowercased account, confirmed by the proof", async () => {
      const { users, service } = doors();

      await expect(service.register(signUp({ email: "Sam@Acme.com" }))).resolves.toEqual({
        id: "user-1",
      });
      expect(users.registerCredentialAccount).toHaveBeenCalledWith({
        name: "Alice",
        email: "sam@acme.com",
        password: "supersecret",
        addressConfirmed: true,
      });
    });
  });

  describe("when the browser is on a web address the installation is not set up for", () => {
    /** @scenario "A sign-up on a web address the installation is not set up for writes no account" */
    it("refuses with the invalid origin code before the proof is spent or the account written", async () => {
      const { users, auth, service } = doors();
      auth.assertSignUpOrigin.mockRejectedValueOnce(new InvalidAuthOriginError());

      await expect(service.register(signUp())).rejects.toMatchObject({
        code: "auth_invalid_origin",
      });
      expect(auth.assertSignUpOrigin).toHaveBeenCalledWith({
        origin: "http://localhost:5560",
        referer: null,
      });
      expect(auth.claimSignUpAddressProof).not.toHaveBeenCalled();
      expect(auth.claimUnconfirmedSignUpAddressProof).not.toHaveBeenCalled();
      expect(users.registerCredentialAccount).not.toHaveBeenCalled();
    });
  });

  describe("when the installation's sign-up policy refuses the address", () => {
    /** @scenario "A refused registration spends no address proof and writes no account" */
    it("refuses with the restricted code before the proof is spent or the account written", async () => {
      const { users, organizations, auth, service } = doors();
      organizations.checkSignUp.mockResolvedValueOnce({ allowed: false, reason: "invite_only" });

      await expect(
        service.register(signUp({ email: "Stranger@Example.com" })),
      ).rejects.toMatchObject({ code: "auth_sign_up_restricted" });
      expect(organizations.checkSignUp).toHaveBeenCalledWith({ email: "stranger@example.com" });
      expect(auth.claimSignUpAddressProof).not.toHaveBeenCalled();
      expect(auth.claimUnconfirmedSignUpAddressProof).not.toHaveBeenCalled();
      expect(users.registerCredentialAccount).not.toHaveBeenCalled();
    });
  });

  describe("when the caller's address is over the sign-up budget", () => {
    /** @scenario "A caller over the sign-up budget is told how long to wait" */
    it("refuses as rate limited, naming the wait, before the proof is spent", async () => {
      const { auth, service } = doors({ allowed: false });

      await expect(service.register(signUp())).rejects.toMatchObject({
        code: "auth_rate_limited",
        meta: { retryAfterSeconds: 1200 },
      });
      expect(auth.isWithinBudget).toHaveBeenCalledWith({
        key: "user.register:127.0.0.1",
        windowSeconds: 3600,
        max: 20,
      });
      expect(auth.claimSignUpAddressProof).not.toHaveBeenCalled();
    });
  });

  describe("when an unconfirmed proof is spent, where the installation cannot send email", () => {
    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("has user mint the account with its address unconfirmed", async () => {
      const { users, auth, service } = doors({ proof: "unconfirmed" });

      await service.register(signUp({ email: "Sam@Acme.com", addressProof: "unconfirmed" }));

      expect(auth.claimUnconfirmedSignUpAddressProof).toHaveBeenCalledWith({
        token: "unconfirmed",
        email: "sam@acme.com",
      });
      expect(users.registerCredentialAccount).toHaveBeenCalledWith(
        expect.objectContaining({ addressConfirmed: false }),
      );
    });

    it("never asks for an unconfirmed proof when a confirmed one was spent", async () => {
      const { auth, service } = doors();

      await service.register(signUp());

      expect(auth.claimUnconfirmedSignUpAddressProof).not.toHaveBeenCalled();
    });
  });

  describe("when the address proof is refused", () => {
    /** @scenario "No credential is collected until the confirmation link is opened" */
    it("refuses as an expired verification and has user write nothing", async () => {
      const { users, service } = doors({ proof: "refused" });

      await expect(service.register(signUp())).rejects.toMatchObject({
        code: "identity_verification_expired",
      });
      expect(users.registerCredentialAccount).not.toHaveBeenCalled();
    });
  });

  describe("when the address proof is offered", () => {
    /** @scenario "No credential is collected until the confirmation link is opened" */
    it("claims it for the lowercased address being registered", async () => {
      const { auth, service } = doors();

      await service.register(signUp({ email: "Sam@Acme.com", addressProof: "proof-1" }));

      expect(auth.claimSignUpAddressProof).toHaveBeenCalledWith({
        token: "proof-1",
        email: "sam@acme.com",
      });
    });

    it("leaves it unspent when the password is refused", async () => {
      const { auth, service } = doors();

      await expect(service.register(signUp({ password: "short" }))).rejects.toMatchObject({
        code: "validation_error",
      });
      expect(auth.claimSignUpAddressProof).not.toHaveBeenCalled();
    });
  });

  describe("given an SSO-capable deployment where the gate denies (coerced email mode)", () => {
    /** @scenario "A fresh unlicensed deployment bootstraps via email signup" */
    it("registers the account through the signup form's own path", async () => {
      const { service } = doors({ provider: "email" });

      await expect(service.register(signUp({ email: "operator@example.com" }))).resolves.toEqual({
        id: "user-1",
      });
    });
  });

  describe("given an SSO-capable deployment where the gate allows", () => {
    /** @scenario "A licensed deployment cannot mint password accounts" */
    it("refuses direct registration", async () => {
      const { users, service } = doors({ provider: "auth0" });

      await expect(service.register(signUp())).rejects.toMatchObject({
        code: "auth_direct_registration_unavailable",
      });
      expect(users.registerCredentialAccount).not.toHaveBeenCalled();
    });
  });

  describe("given a deployment that federates and issues its own passwords (D09)", () => {
    /** @scenario "Sign-up offers a password where the deployment issues its own" */
    it("registers an ordinary address with a password", async () => {
      const { service } = doors({ provider: "auth0", localPasswords: true });

      await expect(service.register(signUp({ email: "sam@home.net" }))).resolves.toEqual({
        id: "user-1",
      });
    });

    /** @scenario "Sign-up offers a password where the deployment issues its own" */
    it("still hands an address whose domain routes to a connection to that provider", async () => {
      const { service } = doors({ provider: "auth0", localPasswords: true, routing: GOVERNED });

      await expect(service.register(signUp({ email: "jo@acme.com" }))).rejects.toMatchObject({
        code: "auth_direct_registration_unavailable",
      });
    });
  });

  describe.each([
    { mode: "email mode", provider: "email", localPasswords: false },
    { mode: "beside a provider (D09)", provider: "auth0", localPasswords: true },
  ])("given a deployment in $mode", ({ provider, localPasswords }) => {
    function expectRefusedUnspent(context: ReturnType<typeof doors>) {
      expect(context.auth.claimSignUpAddressProof).not.toHaveBeenCalled();
      expect(context.auth.claimUnconfirmedSignUpAddressProof).not.toHaveBeenCalled();
      expect(context.users.registerCredentialAccount).not.toHaveBeenCalled();
    }

    /** @scenario "Registering an address an organization signs in through its own connection is refused in every sign-in mode" */
    it("refuses an address an organization routes to its connection, proof unspent", async () => {
      const context = doors({ provider, localPasswords, routing: GOVERNED, taken: true });

      await expect(context.service.register(signUp())).rejects.toMatchObject({
        code: "auth_direct_registration_unavailable",
      });
      expectRefusedUnspent(context);
      expect(context.auth.addressIsRegistered).not.toHaveBeenCalled();
    });

    /** @scenario "Registering an address that already has an account keeps its address proof" */
    it("refuses an address that already has an account, proof unspent", async () => {
      const context = doors({ provider, localPasswords, taken: true });

      await expect(
        context.service.register(signUp({ email: "Sam@Acme.com" })),
      ).rejects.toMatchObject({ code: "auth_direct_registration_unavailable" });
      expect(context.auth.addressIsRegistered).toHaveBeenCalledWith({ email: "sam@acme.com" });
      expectRefusedUnspent(context);
    });

    /** @scenario "Registering an address the sign-in routing offers no password is refused" */
    it("refuses where the routing offers the address no password, proof unspent", async () => {
      const context = doors({ provider, localPasswords, defaultMethods: [PASSKEY] });

      await expect(context.service.register(signUp())).rejects.toMatchObject({
        code: "auth_direct_registration_unavailable",
      });
      expectRefusedUnspent(context);
    });
  });
});
