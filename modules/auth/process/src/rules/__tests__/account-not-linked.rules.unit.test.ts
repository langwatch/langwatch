/** @see specs/auth/sso-wrong-provider-recovery.feature */
import { describe, expect, it } from "vitest";

import { emailDomainOf, signInMethodOfPath } from "../account-not-linked.rules.ts";

const BASE = "https://app.test/api/auth";

describe("signInMethodOfPath", () => {
  describe("when the path is a sign-in callback", () => {
    /** @scenario "A refused link is logged with the sign-in method and the email domain" */
    it.each([
      [`${BASE}/callback/google?code=c&state=s`, "google"],
      [`${BASE}/callback/azure-ad`, "azure-ad"],
      [`${BASE}/oauth2/callback/okta-oidc`, "okta-oidc"],
      [`${BASE}/sso/callback/ssoc_acme`, "ssoc_acme"],
      [`${BASE}/sso/saml2/sp/acs/ssoc_acme`, "ssoc_acme"],
    ])("names the method %s calls back for", (url, method) => {
      expect(signInMethodOfPath({ url })).toBe(method);
    });

    it("keeps a malformed encoded segment as sent, without throwing", () => {
      expect(signInMethodOfPath({ url: `${BASE}/callback/goo%ZZ` })).toBe("goo%ZZ");
    });
  });

  describe("when the path names no method", () => {
    it.each([`${BASE}/sso/callback`, `${BASE}/sign-in/social`, "not a url at all ::"])(
      "answers unknown for %s",
      (url) => {
        expect(signInMethodOfPath({ url })).toBe("unknown");
      },
    );
  });
});

describe("emailDomainOf", () => {
  describe("when the provider returned an address", () => {
    /** @scenario "A refused link is logged with the sign-in method and the email domain" */
    it.each([
      ["andrei@acme.com", "acme.com"],
      ["Andrei@ACME.Com", "acme.com"],
      ['"a@b"@acme.com', "acme.com"],
    ])("keeps only the domain of %s", (email, domain) => {
      expect(emailDomainOf({ email })).toBe(domain);
    });
  });

  describe("when there is no domain to keep", () => {
    it.each([[undefined], [""], ["andrei"], ["andrei@"]])("answers unknown for %s", (email) => {
      expect(emailDomainOf({ email })).toBe("unknown");
    });
  });
});
