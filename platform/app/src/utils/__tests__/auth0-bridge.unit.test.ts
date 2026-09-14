import { describe, expect, it } from "vitest";
import {
  auth0BridgeActive,
  auth0BridgeConnectionOf,
  auth0BridgeMethodForSubject,
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
      expect(auth0BridgeMethodForSubject("google-oauth2|107698")).toBe(
        "auth0-google",
      );
      expect(auth0BridgeMethodForSubject("github|839161")).toBe("auth0-github");
      expect(auth0BridgeMethodForSubject("windowslive|ab12cd")).toBe(
        "auth0-microsoft",
      );
      // The broker's database users and enterprise connections keep the
      // generic method: their sign-ins belong on Auth0's own screen, and a
      // per-tenant connection has a name no hardcoded bridge may guess.
      expect(auth0BridgeMethodForSubject("auth0|64f1c9")).toBeNull();
      expect(auth0BridgeMethodForSubject("samlp|okta-conn|sam")).toBeNull();
      expect(auth0BridgeMethodForSubject("waad|Ab12Cd")).toBeNull();
    });
  });
});
