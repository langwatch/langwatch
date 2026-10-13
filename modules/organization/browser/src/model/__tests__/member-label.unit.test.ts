/** Member label: an account with no display name never reads "null (…)" in a picker (WEB-988). */

import { describe, expect, it } from "vitest";

import { memberLabel } from "../member-label.ts";

describe("memberLabel", () => {
  describe("when the account has a name and an email", () => {
    it("shows both", () => {
      expect(memberLabel({ name: "Ada", email: "ada@example.com" })).toBe("Ada (ada@example.com)");
    });
  });

  describe("when the account has no display name", () => {
    /** @scenario A member with no display name is labelled by their email in team pickers */
    it("shows the email alone", () => {
      expect(memberLabel({ name: null, email: "ada@example.com" })).toBe("ada@example.com");
    });
  });

  describe("when the email is withheld", () => {
    it("shows the name alone", () => {
      expect(memberLabel({ name: "Ada", email: null })).toBe("Ada");
    });
  });

  describe("when neither is known", () => {
    it("falls back to a placeholder", () => {
      expect(memberLabel({ name: null, email: null })).toBe("Unknown user");
    });
  });
});
