import { describe, expect, it } from "vitest";
import {
  isLicenseExpired,
  isCorruptedLicense,
  formatLicenseDate,
  hasLicenseMetadata,
  normalizeKeyForActivation,
} from "../licenseStatusUtils";

/**
 * Pure unit tests for license status utilities.
 * No mocks needed - these are pure functions.
 */

describe("isLicenseExpired", () => {
  it("returns true when license has past expiresAt date", () => {
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
    expect(isLicenseExpired(status)).toBe(true);
  });

  it("returns false when license is corrupted (no metadata)", () => {
    const status = {
      hasLicense: true,
      valid: false,
      corrupted: true,
    } as const;
    expect(isLicenseExpired(status)).toBe(false);
  });

  it("returns false when license is invalid but has future expiresAt", () => {
    const status = {
      hasLicense: true,
      valid: false,
      plan: "team",
      planName: "Team",
      expiresAt: "2099-12-31",
      organizationName: "Test Org",
      currentMembers: 5,
      maxMembers: 10,
    } as const;
    expect(isLicenseExpired(status)).toBe(false);
  });

  it("returns false when license exists and is valid", () => {
    const status = {
      hasLicense: true,
      valid: true,
      plan: "team",
      planName: "Team",
      expiresAt: "2099-12-31",
      organizationName: "Test Org",
      currentMembers: 5,
      maxMembers: 10,
    } as const;
    expect(isLicenseExpired(status)).toBe(false);
  });

  it("returns false when no license exists", () => {
    const status = { hasLicense: false, valid: false } as const;
    expect(isLicenseExpired(status)).toBe(false);
  });

  it("returns false when status is undefined", () => {
    expect(isLicenseExpired(undefined)).toBe(false);
  });

  it("returns false when expiresAt is an invalid date string", () => {
    const status = {
      hasLicense: true,
      valid: false,
      plan: "team",
      planName: "Team",
      expiresAt: "not-a-valid-date",
      organizationName: "Test Org",
      currentMembers: 5,
      maxMembers: 10,
    } as const;
    expect(isLicenseExpired(status)).toBe(false);
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

describe("hasLicenseMetadata", () => {
  it("returns true for valid license with metadata", () => {
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
    expect(hasLicenseMetadata(status)).toBe(true);
  });

  it("returns true for invalid license with metadata (expired)", () => {
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
    expect(hasLicenseMetadata(status)).toBe(true);
  });

  it("returns false for corrupted license without metadata", () => {
    const status = {
      hasLicense: true,
      valid: false,
      corrupted: true,
    } as const;
    expect(hasLicenseMetadata(status)).toBe(false);
  });
});

describe("isCorruptedLicense", () => {
  it("returns true when license is corrupted", () => {
    const status = {
      hasLicense: true,
      valid: false,
      corrupted: true,
    } as const;
    expect(isCorruptedLicense(status)).toBe(true);
  });

  it("returns false for valid license with metadata", () => {
    const status = {
      hasLicense: true,
      valid: true,
      plan: "team",
      planName: "Team",
      expiresAt: "2099-12-31",
      organizationName: "Test Org",
      currentMembers: 5,
      maxMembers: 10,
    } as const;
    expect(isCorruptedLicense(status)).toBe(false);
  });

  it("returns false for invalid license with metadata", () => {
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
    expect(isCorruptedLicense(status)).toBe(false);
  });
});

describe("formatLicenseDate", () => {
  it("formats ISO date string to human-readable format", () => {
    expect(formatLicenseDate("2025-12-31")).toBe("December 31, 2025");
  });

  it("formats full ISO datetime string", () => {
    // Use mid-day UTC to avoid timezone boundary issues
    expect(formatLicenseDate("2025-06-15T12:00:00Z")).toBe("June 15, 2025");
  });

  it("returns original string for invalid date", () => {
    expect(formatLicenseDate("not-a-date")).toBe("not-a-date");
  });
});
