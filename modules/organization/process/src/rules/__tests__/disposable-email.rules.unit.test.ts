/**
 * @vitest-environment node
 * @see specs/auth/sign-up-disposable-email.feature
 */
import { describe, expect, it } from "vitest";

import { isDisposableEmailDomain, refusesDisposableEmails } from "../disposable-email.rules.ts";

describe("refusesDisposableEmails", () => {
  /** @scenario "The cloud refuses disposable addresses and a self-hosted installation allows them by default" */
  it("refuses on the cloud and allows self-hosted when unset, and follows the setting when set", () => {
    expect(refusesDisposableEmails({ setting: undefined, isSaas: true })).toBe(true);
    expect(refusesDisposableEmails({ setting: undefined, isSaas: false })).toBe(false);
    expect(refusesDisposableEmails({ setting: "allow", isSaas: true })).toBe(false);
    expect(refusesDisposableEmails({ setting: "refuse", isSaas: false })).toBe(true);
  });
});

describe("isDisposableEmailDomain", () => {
  describe("when the domain or one of its parents is listed", () => {
    it("matches whatever the case and on any subdomain", () => {
      expect(isDisposableEmailDomain({ domain: "euploading.com" })).toBe(true);
      expect(isDisposableEmailDomain({ domain: "EUploading.COM" })).toBe(true);
      expect(isDisposableEmailDomain({ domain: "a.b.euploading.com" })).toBe(true);
      expect(isDisposableEmailDomain({ domain: "euploading.com." })).toBe(true);
      expect(isDisposableEmailDomain({ domain: "mailinator.com" })).toBe(true);
    });
  });

  describe("when neither the domain nor a parent is listed", () => {
    it("does not match a permanent domain, a look-alike, a bare suffix or nothing", () => {
      expect(isDisposableEmailDomain({ domain: "acme.com" })).toBe(false);
      expect(isDisposableEmailDomain({ domain: "gmail.com" })).toBe(false);
      expect(isDisposableEmailDomain({ domain: "noteuploading.com" })).toBe(false);
      expect(isDisposableEmailDomain({ domain: "com" })).toBe(false);
      expect(isDisposableEmailDomain({ domain: "" })).toBe(false);
    });
  });
});
