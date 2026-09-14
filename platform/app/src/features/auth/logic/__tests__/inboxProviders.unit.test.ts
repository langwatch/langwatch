/**
 * The domain-to-inbox map behind the check-your-email card's door. Exact
 * domain matches only: hosted mail under a custom domain is invisible from
 * the address, so it is treated like a company server and gets no guess.
 */
import { describe, expect, it } from "vitest";
import { inboxUrlFor } from "../inboxProviders";

describe("inboxUrlFor", () => {
  describe("when the address is at a common provider", () => {
    it.each([
      ["sam@gmail.com", "https://mail.google.com/"],
      ["Sam@GMAIL.com", "https://mail.google.com/"],
      ["sam@googlemail.com", "https://mail.google.com/"],
      ["sam@outlook.com", "https://outlook.live.com/mail/"],
      ["sam@hotmail.com", "https://outlook.live.com/mail/"],
      ["sam@live.com", "https://outlook.live.com/mail/"],
      ["sam@yahoo.com", "https://mail.yahoo.com/"],
      ["sam@icloud.com", "https://www.icloud.com/mail/"],
      ["sam@proton.me", "https://mail.proton.me/"],
      ["sam@protonmail.com", "https://mail.proton.me/"],
      ["sam@aol.com", "https://mail.aol.com/"],
    ])("answers the provider's inbox for %s", (email, url) => {
      expect(inboxUrlFor({ email })).toBe(url);
    });
  });

  describe("when the address is anywhere else", () => {
    it.each([
      // A company's own domain.
      "sam@acme-widgets.example",
      // A subdomain of a provider is NOT the provider.
      "sam@mail.gmail.com.evil.example",
      "sam@not-gmail.com",
      // Not an address at all.
      "gmail.com",
      "",
    ])("makes no guess for %s", (email) => {
      expect(inboxUrlFor({ email })).toBeNull();
    });
  });
});
