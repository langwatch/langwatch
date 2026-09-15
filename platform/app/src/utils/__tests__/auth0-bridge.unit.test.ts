import { describe, expect, it } from "vitest";
import {
  auth0BridgeActive,
  auth0BridgeConnectionOf,
  auth0BridgeMethodForSubject,
  auth0BridgeRailIds,
} from "../auth0-bridge";

describe("the Auth0 connection bridge", () => {
  /** @scenario "SaaS shows the broker's social connections as their own buttons" */
  it("dials each branded method as the connection Auth0's own screen offered", () => {
    expect(auth0BridgeConnectionOf("auth0-google")).toBe("google-oauth2");
    expect(auth0BridgeConnectionOf("auth0-github")).toBe("github");
    expect(auth0BridgeConnectionOf("auth0-microsoft")).toBe("windowslive");
    // The generic method and the native providers are not the bridge's to
    // dial: they keep their own providers.
    expect(auth0BridgeConnectionOf("auth0")).toBeNull();
    expect(auth0BridgeConnectionOf("google")).toBeNull();
  });

  it("activates only on SaaS deployments whose provider is the broker", () => {
    expect(auth0BridgeActive({ isSaas: true, authProvider: "auth0" })).toBe(
      true,
    );
    expect(auth0BridgeActive({ isSaas: false, authProvider: "auth0" })).toBe(
      false,
    );
    expect(auth0BridgeActive({ isSaas: true, authProvider: "okta" })).toBe(
      false,
    );
  });

  describe("when routing a stored Auth0 subject to its button", () => {
    it("routes each bridged strategy and nothing else", () => {
      expect(
        auth0BridgeMethodForSubject({ subject: "google-oauth2|107698" }),
      ).toBe("auth0-google");
      expect(auth0BridgeMethodForSubject({ subject: "github|839161" })).toBe(
        "auth0-github",
      );
      expect(
        auth0BridgeMethodForSubject({ subject: "windowslive|ab12cd" }),
      ).toBe("auth0-microsoft");
      // The broker's database users and enterprise connections keep the
      // generic method: their sign-ins belong on Auth0's own screen, and a
      // per-tenant connection has a name no hardcoded bridge may guess.
      expect(
        auth0BridgeMethodForSubject({ subject: "auth0|64f1c9" }),
      ).toBeNull();
      expect(
        auth0BridgeMethodForSubject({ subject: "samlp|okta-conn|sam" }),
      ).toBeNull();
      expect(
        auth0BridgeMethodForSubject({ subject: "waad|Ab12Cd" }),
      ).toBeNull();
    });
  });

  describe("when a bridged provider is mounted natively", () => {
    /** @scenario "A natively mounted provider takes over its own bridge button" */
    it("stands the native button in the bridge slot, in rail order", () => {
      expect(
        auth0BridgeRailIds({ mountedSocialMethodIds: ["google"] }),
      ).toEqual(["google", "auth0-github", "auth0-microsoft"]);
      // Nothing mounted is the bridge as it was.
      expect(auth0BridgeRailIds({ mountedSocialMethodIds: [] })).toEqual([
        "auth0-google",
        "auth0-github",
        "auth0-microsoft",
      ]);
      // Microsoft is `azure-ad` outside better-auth, which is the id the rail
      // and the mounted set both speak.
      expect(
        auth0BridgeRailIds({ mountedSocialMethodIds: ["azure-ad"] }),
      ).toEqual(["auth0-google", "auth0-github", "azure-ad"]);
    });

    /** @scenario "A natively mounted provider takes over its own bridge button" */
    it("routes that provider's brokered subjects to the native method", () => {
      expect(
        auth0BridgeMethodForSubject({
          subject: "google-oauth2|107698",
          mountedSocialMethodIds: ["google"],
        }),
      ).toBe("google");
      // Only the provider that was cut over — the rest keep their bridge.
      expect(
        auth0BridgeMethodForSubject({
          subject: "github|839161",
          mountedSocialMethodIds: ["google"],
        }),
      ).toBe("auth0-github");
      // And the broker's own database users are not a social sign-in at all,
      // so no native client can ever answer for them.
      expect(
        auth0BridgeMethodForSubject({
          subject: "auth0|64f1c9",
          mountedSocialMethodIds: ["google"],
        }),
      ).toBeNull();
    });
  });
});
