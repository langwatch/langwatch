/**
 * The instance's method-set policy, over the four facts a deployment answers.
 *
 * The suite moved with the policy. What it proved before — that ADR-027's
 * semantics survive being expressed as method policy — it proves the same way,
 * except that the environment read and the licence gate are now the inputs the
 * policy takes rather than modules mocked out from under it. That is a
 * stronger test of the same rule: the deployment's four answers are stated
 * here, and nothing in the policy can reach around them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeSignIn } from "@langwatch/identity-contract";
import {
  deploymentIsFederationCapable,
  LOCAL_METHOD_SET,
  PASSWORD_METHOD,
  resolveSignInMethodPolicy,
  type SignInMethodPolicyInputs,
} from "../signin-method-policy.service";

const federationLicensed = vi.fn<() => Promise<boolean>>();
const resolveAuthProvider = vi.fn<() => Promise<string>>();

let selfHosted = true;
let offersPasskeys = false;

const inputs: SignInMethodPolicyInputs = {
  resolveAuthProvider: () => resolveAuthProvider(),
  federationLicensed: () => federationLicensed(),
  offersPasskeys: () => offersPasskeys,
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
  });
  describe("given a self-hosted installation configured with a single OAuth provider", () => {
    beforeEach(() => {
      licensedStore(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    it("makes the configured provider the offered method, exactly as before", async () => {
      const policy = await resolveSignInMethodPolicy(inputs);

      expect(policy.defaultMethods).toEqual([
        { id: "auth0", kind: "federated", connectionId: null },
      ]);
      expect(policy.federationLicensed).toBe(true);
      expect(policy.selfHosted).toBe(true);
    });

    /** @scenario "The provider env becomes the default method set" */
    it("ends nothing when a second method joins the set", async () => {
      const policy = await resolveSignInMethodPolicy(inputs);
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
      const policy = await resolveSignInMethodPolicy(inputs);

      expect(policy.federationLicensed).toBe(false);
      expect(policy.defaultMethods).toEqual([PASSWORD_METHOD]);
      expect(policy.localMethods).toEqual(LOCAL_METHOD_SET);
      expect(policy.defaultMethods.some((method: { kind: string }) => method.kind === "federated")).toBe(false);
    });

    /** @scenario "A never-licensed installation offers no federated method" */
    it("keeps every federated method out of the routing decision too", async () => {
      const policy = await resolveSignInMethodPolicy(inputs);

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
      expect(deploymentIsFederationCapable("email")).toBe(false);
      expect(federationLicensed).not.toHaveBeenCalled();
    });
  });
});
