/**
 * The instance's method-set policy, over the four facts a deployment answers. semantics survive
 * being expressed as method policy — it proves the same way,
 * The suite moved with the policy. What it proved before — that ADR-027's
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LOCAL_METHOD_SET,
  PASSKEY_METHOD,
  PASSWORD_METHOD,
  SignInMethodPolicyService,
  type SignInMethodPolicyInputs,
} from "../signin-method-policy.ts";
import { routeSignIn, routingIdentifierOf } from "../signin-routing.ts";

const federationLicensed = vi.fn<() => Promise<boolean>>();
const resolveAuthProvider = vi.fn<() => Promise<string>>();

let selfHosted = true;
let offersPasskeys = false;
let issuesOwnPasswords = false;

const inputs: SignInMethodPolicyInputs = {
  resolveAuthProvider: () => resolveAuthProvider(),
  federationLicensed: () => federationLicensed(),
  offersPasskeys: () => offersPasskeys,
  issuesOwnPasswords: () => issuesOwnPasswords,
  selfHosted: () => selfHosted,
};

/**
 * The gate as ADR-027 leaves it: a denied licence is reported by
 * `resolveAuthProvider` as email mode, which is the coercion the policy trusts
 * rather than repeating.
 */
function licensedStore(licensed: boolean) {
  federationLicensed.mockResolvedValue(licensed);
  resolveAuthProvider.mockResolvedValue(licensed ? "auth0" : "email");
}

describe("the instance sign-in method policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selfHosted = true;
    offersPasskeys = false;
    issuesOwnPasswords = false;
  });
  describe("given a self-hosted installation configured with a single OAuth provider", () => {
    beforeEach(() => {
      licensedStore(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    /** @scenario "A licensed self-hosted deployment reports federation as licensed" */
    it("makes the configured provider the offered method, exactly as before", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      expect(policy.defaultMethods).toEqual([
        { id: "auth0", kind: "federated", connectionId: null },
      ]);
      expect(policy.federationLicensed).toBe(true);
      expect(policy.selfHosted).toBe(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    it("ends nothing when a second method joins the set", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();
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

  describe("given a deployment that offers passkeys", () => {
    beforeEach(() => {
      licensedStore(true);
      offersPasskeys = true;
    });

    it("appends the passkey to the default method set", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      expect(policy.defaultMethods[policy.defaultMethods.length - 1]).toEqual(PASSKEY_METHOD);
    });

    /**
     * Break-glass has to work from any machine. A passkey is bound to one
     * device, so naming it in the set would fail exactly the person who
     * needs break-glass — sitting at a different machine.
     */
    it("keeps the passkey out of the break-glass set", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      expect(policy.localMethods).toEqual(LOCAL_METHOD_SET);
      expect(policy.localMethods).not.toContainEqual(PASSKEY_METHOD);
    });
  });

  describe("given a license gate that denies", () => {
    /**
     * The gate evicts its memo on rejection (ADR-027 Decision 6): a second
     * read would be a second licensing scan, holding slow database reads
     * open exactly when the database is already struggling.
     */
    it("does not ask the provider resolver a second question", async () => {
      licensedStore(false);

      await SignInMethodPolicyService.create(inputs).resolvePolicy();

      expect(resolveAuthProvider).not.toHaveBeenCalled();
    });
  });

  describe("given a self-hosted installation whose license gate denies", () => {
    beforeEach(() => {
      licensedStore(false);
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("offers the email and password method set and no federated one", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      expect(policy.federationLicensed).toBe(false);
      expect(policy.defaultMethods).toEqual([PASSWORD_METHOD]);
      expect(policy.localMethods).toEqual(LOCAL_METHOD_SET);
      expect(
        policy.defaultMethods.some((method: { kind: string }) => method.kind === "federated"),
      ).toBe(false);
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("keeps every federated method out of the routing decision too", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      const decision = routeSignIn({
        identifier: null,
        breakGlass: false,
        policy,
        domainConnection: null,
        activeConnections: [],
      });

      expect(decision.outcome).toBe("method_picker");
      expect(decision.methodSet).toEqual([PASSWORD_METHOD]);
    });
  });

  describe("when the deployment names no federated method at all", () => {
    it("answers the capability question without waiting on the licensing store", () => {
      // Synchronous by contract: the before-hook must be able to leave an
      // email-mode deployment alone without a store read in the way.
      expect(SignInMethodPolicyService.deploymentIsFederationCapable("email")).toBe(false);
      expect(federationLicensed).not.toHaveBeenCalled();
    });
  });
  describe("when the deployment issues its own passwords beside its provider", () => {
    beforeEach(() => {
      licensedStore(true);
      offersPasskeys = true;
      issuesOwnPasswords = true;
    });

    /** @scenario "A deployment that issues its own passwords offers one beside its provider" */
    it("offers the password behind the federated method, which still leads", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      expect(policy.defaultMethods).toEqual([
        { id: "auth0", kind: "federated", connectionId: null },
        PASSWORD_METHOD,
        PASSKEY_METHOD,
      ]);
    });

    /** @scenario "A deployment that issues its own passwords offers one beside its provider" */
    it("offers no password beside it when the deployment does not issue its own", async () => {
      issuesOwnPasswords = false;

      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      expect(policy.defaultMethods.map((method) => method.id)).toEqual(["auth0", "passkey"]);
    });

    /** @scenario "The credential routes answer on a deployment that offers a password" */
    it("ranks a password the account holds, which is what lets it be offered back", async () => {
      const policy = await SignInMethodPolicyService.create(inputs).resolvePolicy();

      const decision = routeSignIn({
        identifier: routingIdentifierOf("sam@home.net"),
        breakGlass: false,
        policy,
        domainConnection: null,
        activeConnections: [],
        account: { hasPassword: true, hasPasskey: false, providerIds: [], connectionIds: [] },
      });

      expect(decision.methodSet.map((method) => method.id)).toEqual(["password"]);
    });
  });
});
