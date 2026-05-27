import { describe, expect, it } from "vitest";
import { isLangwatchStaff } from "../isLangwatchStaff";

describe("isLangwatchStaff", () => {
  describe("given a missing or empty email", () => {
    it("returns false for null", () => {
      expect(isLangwatchStaff(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isLangwatchStaff(undefined)).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isLangwatchStaff("")).toBe(false);
    });
  });

  describe("given an @langwatch.ai email", () => {
    it("accepts the canonical lowercase form", () => {
      expect(isLangwatchStaff("aryan@langwatch.ai")).toBe(true);
    });

    it("accepts mixed-case domain", () => {
      expect(isLangwatchStaff("Aryan@Langwatch.AI")).toBe(true);
    });

    it("accepts surrounding whitespace (trim before suffix check)", () => {
      expect(isLangwatchStaff("  aryan@langwatch.ai  ")).toBe(true);
      expect(isLangwatchStaff("aryan@langwatch.ai\n")).toBe(true);
    });
  });

  describe("given a non-staff email", () => {
    it("rejects plain third-party domains", () => {
      expect(isLangwatchStaff("user@example.com")).toBe(false);
      expect(isLangwatchStaff("attacker@gmail.com")).toBe(false);
    });
  });

  describe("given a suffix-spoof attempt", () => {
    // Suffix check has to be on the whole email; a host like
    // `langwatch.ai.attacker.com` ends in `.com`, NOT `@langwatch.ai`,
    // so the endsWith(...) check correctly rejects it. Pin this so a
    // future refactor (e.g. to a substring check) can't silently let
    // a spoofed domain through.
    it("rejects an attacker-controlled subdomain ending with langwatch.ai-ish text", () => {
      expect(isLangwatchStaff("user@langwatch.ai.attacker.com")).toBe(false);
    });

    it("rejects a username that contains @langwatch.ai but a different host", () => {
      expect(isLangwatchStaff("user+@langwatch.ai@evil.example")).toBe(false);
    });

    it("rejects a host that merely contains 'langwatch.ai' as a substring", () => {
      expect(isLangwatchStaff("user@notlangwatch.ai")).toBe(false);
    });
  });
});
