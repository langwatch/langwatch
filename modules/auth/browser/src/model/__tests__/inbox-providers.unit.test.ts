/**
 * The domain-to-provider map behind the check-your-email card's door. Exact
 * matches only; every domain is listed, because the id picks the mark drawn.
 */
import { describe, expect, it } from "vitest";

import { findInboxProvider } from "../inbox-providers.ts";

describe("findInboxProvider", () => {
  describe("when the address is at a common provider", () => {
    it.each([
      ["sam@gmail.com", "gmail", "https://mail.google.com/"],
      ["Sam@GMAIL.com", "gmail", "https://mail.google.com/"],
      ["sam@googlemail.com", "gmail", "https://mail.google.com/"],
      ["sam@outlook.com", "outlook", "https://outlook.live.com/mail/"],
      ["sam@hotmail.com", "outlook", "https://outlook.live.com/mail/"],
      ["sam@live.com", "outlook", "https://outlook.live.com/mail/"],
      ["sam@msn.com", "outlook", "https://outlook.live.com/mail/"],
      ["sam@yahoo.com", "yahoo", "https://mail.yahoo.com/"],
      ["sam@ymail.com", "yahoo", "https://mail.yahoo.com/"],
      ["sam@icloud.com", "icloud", "https://www.icloud.com/mail/"],
      ["sam@me.com", "icloud", "https://www.icloud.com/mail/"],
      ["sam@mac.com", "icloud", "https://www.icloud.com/mail/"],
      ["sam@proton.me", "proton", "https://mail.proton.me/"],
      ["sam@protonmail.com", "proton", "https://mail.proton.me/"],
      ["sam@pm.me", "proton", "https://mail.proton.me/"],
      ["sam@aol.com", "aol", "https://mail.aol.com/"],
    ])("answers %s with the provider %s at %s", (email, id, url) => {
      expect(findInboxProvider({ email })).toEqual([{ id, url }]);
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
      expect(findInboxProvider({ email })).toEqual([]);
    });
  });
});
