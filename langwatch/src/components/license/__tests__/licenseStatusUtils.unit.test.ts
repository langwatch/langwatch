import { describe, expect, it } from "vitest";
import {
  isLicenseExpired,
  isCorruptedLicense,
  formatLicenseDate,
  hasLicenseMetadata,
  normalizeKeyForActivation,
  formatLimitOrUnlimited,
  formatResourceUsage,
  formatFileSize,
} from "../licenseStatusUtils";

/**
 * Pure unit tests for license status utilities.
 * No mocks needed - these are pure functions.
 */

/** Base resource fields for license status */
const baseResourceFields = {
  currentMembers: 5,
  maxMembers: 10,
  currentMembersLite: 2,
  maxMembersLite: 5,
  currentTeams: 2,
  maxTeams: 5,
  currentProjects: 3,
  maxProjects: 10,
  currentPrompts: 5,
  maxPrompts: 20,
  currentWorkflows: 4,
  maxWorkflows: 15,
  currentScenarios: 2,
  maxScenarios: 10,
  currentEvaluators: 3,
  maxEvaluators: 10,
  currentAgents: 2,
  maxAgents: 10,
  currentExperiments: 2,
  maxExperiments: 10,
  currentOnlineEvaluations: 2,
  maxOnlineEvaluations: 10,
  currentMessagesPerMonth: 500,
  maxMessagesPerMonth: 10000,
  currentEvaluationsCredit: 25,
  maxEvaluationsCredit: 100,
} as const;

/**
 * Creates a valid LicenseStatus with all required resource fields.
 */
function createValidLicenseStatus(expiresAt = "2099-12-31") {
  return {
    hasLicense: true as const,
    valid: true as const,
    plan: "team",
    planName: "Team",
    expiresAt,
    organizationName: "Test Org",
    ...baseResourceFields,
  };
}

/**
 * Creates an invalid LicenseStatus with all required resource fields.
 */
function createInvalidLicenseStatus(expiresAt = "2023-12-31") {
  return {
    hasLicense: true as const,
    valid: false as const,
    plan: "team",
    planName: "Team",
    expiresAt,
    organizationName: "Test Org",
    ...baseResourceFields,
  };
}

describe("isLicenseExpired", () => {
  it("returns true when license has past expiresAt date", () => {
    const status = createInvalidLicenseStatus("2023-12-31");
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
    const status = createInvalidLicenseStatus("2099-12-31");
    expect(isLicenseExpired(status)).toBe(false);
  });

  it("returns false when license exists and is valid", () => {
    const status = createValidLicenseStatus("2099-12-31");
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
    const status = createInvalidLicenseStatus("not-a-valid-date");
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
    const status = createValidLicenseStatus("2025-12-31");
    expect(hasLicenseMetadata(status)).toBe(true);
  });

  it("returns true for invalid license with metadata (expired)", () => {
    const status = createInvalidLicenseStatus("2023-12-31");
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
    const status = createValidLicenseStatus("2099-12-31");
    expect(isCorruptedLicense(status)).toBe(false);
  });

  it("returns false for invalid license with metadata", () => {
    const status = createInvalidLicenseStatus("2023-12-31");
    expect(isCorruptedLicense(status)).toBe(false);
  });
});

describe("formatLimitOrUnlimited", () => {
  it("returns 'Unlimited' for Infinity", () => {
    expect(formatLimitOrUnlimited(Infinity)).toBe("Unlimited");
  });

  it("returns formatted number for values under 1M", () => {
    expect(formatLimitOrUnlimited(100)).toBe("100");
    expect(formatLimitOrUnlimited(1000)).toBe("1,000");
    expect(formatLimitOrUnlimited(50000)).toBe("50,000");
    expect(formatLimitOrUnlimited(999_999)).toBe("999,999");
  });

  it("returns 'Unlimited' for values >= 1M", () => {
    expect(formatLimitOrUnlimited(1_000_000)).toBe("Unlimited");
    expect(formatLimitOrUnlimited(Number.MAX_SAFE_INTEGER)).toBe("Unlimited");
  });
});

describe("formatResourceUsage", () => {
  it("formats current/max pair with normal limits", () => {
    expect(formatResourceUsage(5, 10)).toBe("5 / 10");
    expect(formatResourceUsage(1000, 5000)).toBe("1,000 / 5,000");
  });

  it("displays 'Unlimited' for Infinity max", () => {
    expect(formatResourceUsage(5, Infinity)).toBe("5 / Unlimited");
  });

  it("displays 'Unlimited' for large max values (>= 1M)", () => {
    expect(formatResourceUsage(5, 1_000_000)).toBe("5 / Unlimited");
    expect(formatResourceUsage(5, Number.MAX_SAFE_INTEGER)).toBe(
      "5 / Unlimited"
    );
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

describe("formatFileSize", () => {
  it("formats bytes correctly", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
