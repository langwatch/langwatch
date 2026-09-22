/**
 * A login overwrites the session on this machine in place. Logging in as a
 * second account left every command answering from the first account's
 * organization, with nothing on screen saying the account had changed.
 */
import { describe, expect, it } from "vitest";

import { replacedSessionNotice } from "../login-flow";

const ACME = {
  user: { email: "someone@acme.example" },
  organization: { id: "org_acme", slug: "acme", name: "ACME" },
};

const OTHER = {
  user: { email: "someone+test@acme.example" },
  organization: { id: "org_test", slug: "test-org", name: "Test Org" },
};

describe("replacedSessionNotice()", () => {
  describe("when the machine already holds another organization's login", () => {
    /** @scenario "Logging in as another organization says whose login it replaced" */
    it("names both sides", () => {
      const notice = replacedSessionNotice({ previous: ACME, next: OTHER });

      expect(notice).toContain("someone@acme.example in ACME");
      expect(notice).toContain("someone+test@acme.example in Test Org");
    });

    it("says the previous login is signed out, not merely changed", () => {
      expect(replacedSessionNotice({ previous: ACME, next: OTHER })).toContain(
        "signed out",
      );
    });
  });

  describe("when the same organization logs in again", () => {
    /** @scenario "Logging in again as the same organization says nothing extra" */
    it("says nothing", () => {
      expect(
        replacedSessionNotice({
          previous: ACME,
          next: {
            user: { email: "someone@acme.example" },
            organization: { id: "org_acme", slug: "acme", name: "ACME" },
          },
        }),
      ).toBeUndefined();
    });

    it("says nothing for a different account inside that organization", () => {
      expect(
        replacedSessionNotice({
          previous: ACME,
          next: {
            user: { email: "colleague@acme.example" },
            organization: { id: "org_acme", slug: "acme", name: "ACME" },
          },
        }),
      ).toBeUndefined();
    });
  });

  describe("when the machine holds no login yet", () => {
    it("says nothing, because nothing is being replaced", () => {
      expect(
        replacedSessionNotice({ previous: {}, next: OTHER }),
      ).toBeUndefined();
    });
  });

  describe("when the stored login predates recorded organization names", () => {
    it("falls back to the slug rather than printing a blank", () => {
      const notice = replacedSessionNotice({
        previous: {
          user: { email: "someone@acme.example" },
          organization: { id: "org_acme", slug: "acme" },
        },
        next: OTHER,
      });

      expect(notice).toContain("someone@acme.example in acme");
    });
  });
});
