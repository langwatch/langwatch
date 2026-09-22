/**
 * @vitest-environment node
 * Whether a deployment has a door for an organization's legacy pin. Decides
 * only whether there IS a door: the callback still holds the pin against the
 * arriving account, so the wrong upstream is refused there exactly as before.
 */
import { describe, expect, it } from "vitest";

import { legacySsoDialOf } from "../legacy-sso-dial.rules.ts";

describe("given a deployment that brokers sign-in through one provider", () => {
  /** @scenario "An organization pinned to a provider behind the broker is sent to the broker" */
  it.each([["waad|acme-connection"], ["samlp|acme-saml"], ["acme-enterprise"]])(
    "dials the broker for the pin %s",
    (pin) => {
      expect(legacySsoDialOf({ pin, mountedMethodId: "auth0" })).toEqual({
        dialable: true,
        methodId: "auth0",
      });
    },
  );

  /** @scenario "An organization pinned to a provider behind the broker is sent to the broker" */
  it("dials the broker for a pin naming the broker itself", () => {
    expect(legacySsoDialOf({ pin: "auth0", mountedMethodId: "auth0" })).toEqual({
      dialable: true,
      methodId: "auth0",
    });
  });
});

describe("given a deployment mounting a provider of its own", () => {
  /** @scenario "The deployment's own mounted provider still counts as configured" */
  it("dials it for an organization pinned to that provider", () => {
    expect(legacySsoDialOf({ pin: "okta", mountedMethodId: "okta" })).toEqual({
      dialable: true,
      methodId: "okta",
    });
  });

  /** @scenario "An organization naming a provider this deployment does not mount is not sent nowhere" */
  it("carries a pin naming a different provider nowhere", () => {
    expect(legacySsoDialOf({ pin: "azure-ad", mountedMethodId: "okta" })).toEqual({
      dialable: false,
    });
  });
});

describe("given a deployment that mounts nothing to dial", () => {
  /** @scenario "An organization naming a provider this deployment does not mount is not sent nowhere" */
  it.each([["auth0"], ["okta"], ["waad|acme-connection"]])("carries the pin %s nowhere", (pin) => {
    expect(legacySsoDialOf({ pin, mountedMethodId: null })).toEqual({ dialable: false });
  });
});

describe("given an organization whose pin is blank", () => {
  /** @scenario "An organization naming a provider this deployment does not mount is not sent nowhere" */
  it.each([["auth0"], ["okta"]])("carries it nowhere, even under %s", (mountedMethodId) => {
    expect(legacySsoDialOf({ pin: "", mountedMethodId })).toEqual({ dialable: false });
  });
});
