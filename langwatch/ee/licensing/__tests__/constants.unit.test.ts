import { describe, expect, it } from "vitest";
import {
  LICENSE_ERRORS,
  LICENSE_ERROR_MESSAGES,
  getUserFriendlyLicenseError,
} from "../constants";

/**
 * Tests for license error message utilities.
 * Verifies that user-friendly error messages are properly mapped.
 */

describe("LICENSE_ERROR_MESSAGES", () => {
  it("maps INVALID_FORMAT to user-friendly message", () => {
    expect(LICENSE_ERROR_MESSAGES[LICENSE_ERRORS.INVALID_FORMAT]).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("maps INVALID_SIGNATURE to user-friendly message", () => {
    expect(LICENSE_ERROR_MESSAGES[LICENSE_ERRORS.INVALID_SIGNATURE]).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("maps EXPIRED to user-friendly message", () => {
    expect(LICENSE_ERROR_MESSAGES[LICENSE_ERRORS.EXPIRED]).toBe(
      "This license has expired. Please contact support to renew your license."
    );
  });
});

describe("getUserFriendlyLicenseError", () => {
  it("returns user-friendly message for invalid format", () => {
    expect(getUserFriendlyLicenseError("Invalid license format")).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("returns user-friendly message for invalid signature", () => {
    expect(getUserFriendlyLicenseError("Invalid signature")).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("returns user-friendly message for expired license", () => {
    expect(getUserFriendlyLicenseError("License expired")).toBe(
      "This license has expired. Please contact support to renew your license."
    );
  });

  it("returns original error for unknown error messages", () => {
    const unknownError = "Some unknown error";
    expect(getUserFriendlyLicenseError(unknownError)).toBe(unknownError);
  });
});
