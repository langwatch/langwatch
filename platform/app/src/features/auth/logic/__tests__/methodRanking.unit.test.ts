import type { SignInMethod } from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import {
  rankMethodsForBrowser,
  shouldStartPasskeyOnArrival,
} from "../methodRanking";

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

describe("given a method set the server has already ranked", () => {
  describe("when this browser remembers nothing", () => {
    /** @scenario A local hint never overrules the deployment's own ranking */
    it("keeps the server's order untouched", () => {
      expect(
        rankMethodsForBrowser({ methodSet: [passkey, okta, password] }),
      ).toEqual([passkey, okta, password]);
    });
  });

  describe("when this browser remembers a method that is on offer", () => {
    /** @scenario The method last used on this device leads, and is badged */
    it("promotes it and leaves everything below it in the server's order", () => {
      expect(
        rankMethodsForBrowser({
          methodSet: [passkey, okta, password],
          lastUsedMethodId: "password",
        }),
      ).toEqual([password, passkey, okta]);
    });
  });

  describe("when this browser remembers a method that is not on offer", () => {
    /** @scenario A local hint never overrules the deployment's own ranking */
    it("promotes nothing, because a stale note is not an instruction", () => {
      expect(
        rankMethodsForBrowser({
          methodSet: [passkey, password],
          lastUsedMethodId: "gitlab",
        }),
      ).toEqual([passkey, password]);
    });
  });
});

describe("given a screen deciding whether to start a passkey ceremony", () => {
  describe("when the decision was made about an account holding one", () => {
    /** @scenario An account with a passkey is asked for it, not offered a button */
    it("starts it", () => {
      expect(
        shouldStartPasskeyOnArrival({
          reasonCode: "account_methods",
          methodSet: [passkey, password],
          alreadyTried: false,
        }),
      ).toBe(true);
    });
  });

  describe("when the method set is the instance's rather than an account's", () => {
    /** @scenario An account with a passkey is asked for it, not offered a button */
    it("starts nothing, because a passkey on offer is not a passkey held", () => {
      // `no_domain_match` means "here is what this deployment offers". Reading
      // it as "you have one of these" would prompt somebody who has never
      // registered a passkey in their life.
      expect(
        shouldStartPasskeyOnArrival({
          reasonCode: "no_domain_match",
          methodSet: [passkey, password],
          alreadyTried: false,
        }),
      ).toBe(false);
    });
  });

  describe("when a ceremony on this screen has already been declined", () => {
    /** @scenario A declined passkey falls back to the next method, and does not ask again */
    it("never starts a second one on its own", () => {
      expect(
        shouldStartPasskeyOnArrival({
          reasonCode: "account_methods",
          methodSet: [passkey, password],
          alreadyTried: true,
        }),
      ).toBe(false);
    });
  });

  describe("when the account holds no passkey", () => {
    it("starts nothing", () => {
      expect(
        shouldStartPasskeyOnArrival({
          reasonCode: "account_methods",
          methodSet: [password],
          alreadyTried: false,
        }),
      ).toBe(false);
    });
  });
});
