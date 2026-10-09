import { describe, expect, it } from "vitest";
import { legacySsoDialOf } from "../legacy-sso-dial";

/**
 * Spec: specs/identity/sso-idp-termination.feature
 */
describe("given a deployment that brokers sign-in through one provider", () => {
  describe("when an organization pins its people to a provider behind the broker", () => {
    /** @scenario "An organization pinned to a provider behind the broker is sent to the broker" */
    it.each([
      ["waad|acme-connection"],
      ["samlp|acme-saml"],
      ["acme-enterprise"],
    ])("dials the broker for the pin %s", (pin) => {
      expect(legacySsoDialOf({ pin, mountedMethodId: "auth0" })).toBe("auth0");
    });

    /** @scenario "An organization pinned to a provider behind the broker is sent to the broker" */
    it("dials the broker for a pin naming the broker itself", () => {
      expect(legacySsoDialOf({ pin: "auth0", mountedMethodId: "auth0" })).toBe(
        "auth0",
      );
    });
  });
});

describe("given a deployment mounting a provider of its own", () => {
  describe("when an organization pins its people to that provider", () => {
    /** @scenario "The deployment's own mounted provider still counts as configured" */
    it("dials it", () => {
      expect(legacySsoDialOf({ pin: "okta", mountedMethodId: "okta" })).toBe(
        "okta",
      );
    });
  });

  describe("when an organization pins its people to a different provider", () => {
    /** @scenario "An organization naming a provider this deployment does not mount is not sent nowhere" */
    it("carries the pin nowhere", () => {
      expect(
        legacySsoDialOf({ pin: "azure-ad", mountedMethodId: "okta" }),
      ).toBeNull();
    });
  });
});

describe("given a deployment that mounts nothing to dial", () => {
  describe("when an organization pins its people to any provider", () => {
    /** @scenario "An organization naming a provider this deployment does not mount is not sent nowhere" */
    it.each([
      ["auth0"],
      ["okta"],
      ["waad|acme-connection"],
    ])("carries the pin %s nowhere", (pin) => {
      expect(legacySsoDialOf({ pin, mountedMethodId: null })).toBeNull();
    });
  });
});

describe("given an organization whose pin is blank", () => {
  describe("when the deployment is asked what carries it", () => {
    /** @scenario "An organization naming a provider this deployment does not mount is not sent nowhere" */
    it.each([
      ["auth0"],
      ["okta"],
    ])("carries it nowhere, even under %s", (mountedMethodId) => {
      expect(legacySsoDialOf({ pin: "", mountedMethodId })).toBeNull();
    });
  });
});
