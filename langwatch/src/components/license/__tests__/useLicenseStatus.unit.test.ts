import { describe, expect, it } from "vitest";
import { deriveIsExpired, formatLicenseDate, normalizeKeyForActivation } from "../useLicenseStatus";

/**
 * Pure unit tests for license status logic.
 * No mocks needed - these are pure functions.
 *
 * The hook itself is orchestration code (wiring tRPC, state, toasts).
 * Orchestration is tested via integration tests, not unit tests.
 */

describe("deriveIsExpired", () => {
  it("returns true when license exists but is invalid (expired)", () => {
    const status = {
      hasLicense: true,
      valid: false,
      plan: "team",
      planName: "Team",
      expiresAt: "2023-12-31",
      organizationName: "Test Org",
      currentMembers: 5,
      maxMembers: 10,
    } as const;
    expect(deriveIsExpired(status)).toBe(true);
  });

  it("returns true when license is corrupted", () => {
    const status = { hasLicense: true, valid: false, corrupted: true } as const;
    expect(deriveIsExpired(status)).toBe(true);
  });

  it("returns false when license exists and is valid", () => {
    const status = {
      hasLicense: true,
      valid: true,
      plan: "team",
      planName: "Team",
      expiresAt: "2025-12-31",
      organizationName: "Test Org",
      currentMembers: 5,
      maxMembers: 10,
    } as const;
    expect(deriveIsExpired(status)).toBe(false);
  });

  it("returns false when no license exists", () => {
    const status = { hasLicense: false, valid: false } as const;
    expect(deriveIsExpired(status)).toBe(false);
  });

  it("returns false when status is undefined", () => {
    expect(deriveIsExpired(undefined)).toBe(false);
  });
});

describe("normalizeKeyForActivation", () => {
  it("returns null for empty string", () => {
    expect(normalizeKeyForActivation("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeKeyForActivation("   ")).toBeNull();
    expect(normalizeKeyForActivation("\t\n")).toBeNull();
  });

  it("trims and returns valid key", () => {
    expect(normalizeKeyForActivation("  abc123  ")).toBe("abc123");
  });

  it("returns key unchanged when no trimming needed", () => {
    expect(normalizeKeyForActivation("abc123")).toBe("abc123");
  });
});

describe("formatLicenseDate", () => {
  it("formats ISO date string to human-readable format", () => {
    expect(formatLicenseDate("2025-12-31")).toBe("December 31, 2025");
  });

  it("formats full ISO datetime string", () => {
    expect(formatLicenseDate("2025-06-15T00:00:00Z")).toBe("June 15, 2025");
  });

  it("returns original string for invalid date", () => {
    expect(formatLicenseDate("not-a-date")).toBe("not-a-date");
  });
});
