import { describe, expect, it } from "vitest";
import { isLangwatchStaff } from "../isLangwatchStaff";

const verifiedStaff = (email: string) => ({ email, emailVerified: true });

describe("isLangwatchStaff", () => {
  describe("given a missing or empty user", () => {
    it("returns false for null", () => {
      expect(isLangwatchStaff(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isLangwatchStaff(undefined)).toBe(false);
    });

    it("returns false for empty email", () => {
      expect(isLangwatchStaff({ email: "", emailVerified: true })).toBe(false);
    });

    it("returns false for null email", () => {
      expect(isLangwatchStaff({ email: null, emailVerified: true })).toBe(
        false,
      );
    });
  });

  describe("given an @langwatch.ai email", () => {
    it("accepts the canonical lowercase form", () => {
      expect(isLangwatchStaff(verifiedStaff("aryan@langwatch.ai"))).toBe(true);
    });

    it("accepts mixed-case domain", () => {
      expect(isLangwatchStaff(verifiedStaff("Aryan@Langwatch.AI"))).toBe(true);
    });

    it("accepts surrounding whitespace (trim before suffix check)", () => {
      expect(isLangwatchStaff(verifiedStaff("  aryan@langwatch.ai  "))).toBe(
        true,
      );
      expect(isLangwatchStaff(verifiedStaff("aryan@langwatch.ai\n"))).toBe(
        true,
      );
    });
  });

  describe("given an unverified email", () => {
    // Self-hosted NEXTAUTH_PROVIDER=email mode lets anyone register with any
    // address. Without this check, registering attacker@langwatch.ai would
    // bypass the release_langy_enabled flag the moment the session is minted.
    it("rejects @langwatch.ai with emailVerified=false", () => {
      expect(
        isLangwatchStaff({
          email: "attacker@langwatch.ai",
          emailVerified: false,
        }),
      ).toBe(false);
    });

    it("rejects @langwatch.ai with emailVerified missing", () => {
      expect(isLangwatchStaff({ email: "attacker@langwatch.ai" })).toBe(false);
    });

    it("rejects @langwatch.ai with emailVerified=null", () => {
      expect(
        isLangwatchStaff({
          email: "attacker@langwatch.ai",
          emailVerified: null,
        }),
      ).toBe(false);
    });
  });

  describe("given a non-staff email", () => {
    it("rejects plain third-party domains", () => {
      expect(isLangwatchStaff(verifiedStaff("user@example.com"))).toBe(false);
      expect(isLangwatchStaff(verifiedStaff("attacker@gmail.com"))).toBe(
        false,
      );
    });
  });

  describe("given a suffix-spoof attempt", () => {
    // Suffix check has to be on the whole email; a host like
    // `langwatch.ai.attacker.com` ends in `.com`, NOT `@langwatch.ai`,
    // so the endsWith(...) check correctly rejects it. Pin this so a
    // future refactor (e.g. to a substring check) can't silently let
    // a spoofed domain through.
    it("rejects an attacker-controlled subdomain ending with langwatch.ai-ish text", () => {
      expect(
        isLangwatchStaff(verifiedStaff("user@langwatch.ai.attacker.com")),
      ).toBe(false);
    });

    it("rejects a username that contains @langwatch.ai but a different host", () => {
      expect(
        isLangwatchStaff(verifiedStaff("user+@langwatch.ai@evil.example")),
      ).toBe(false);
    });

    it("rejects a host that merely contains 'langwatch.ai' as a substring", () => {
      expect(isLangwatchStaff(verifiedStaff("user@notlangwatch.ai"))).toBe(
        false,
      );
    });
  });
});
