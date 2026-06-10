/**
 * @see specs/security/api-endpoint-authorization.feature
 *
 * Regression guard for the fail-open cron/internal auth: when CRON_API_KEY was
 * unset, `header === process.env.CRON_API_KEY` evaluated `undefined ===
 * undefined === true`, so a credential-less request to destructive cron jobs
 * (retention cleanup, lambda deletion) and the worker/ops endpoints was
 * accepted.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isInternalSecretValid } from "../internal-secret";

// Exercise the pure comparison seam directly: `validateInternalSecret(Context)`
// is a one-line adapter over `isInternalSecretValid(authorizationHeader)`.
const ctx = (authorization?: string) => authorization;
const validateInternalSecret = (authorization: string | undefined) =>
  isInternalSecretValid(authorization);

describe("validateInternalSecret", () => {
  let original: string | undefined;
  beforeEach(() => {
    original = process.env.CRON_API_KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.CRON_API_KEY;
    else process.env.CRON_API_KEY = original;
  });

  describe("when CRON_API_KEY is not configured", () => {
    /** @scenario "An unset internal secret denies all callers" */
    it("denies a credential-less request (the fail-open regression)", () => {
      delete process.env.CRON_API_KEY;
      expect(validateInternalSecret(ctx(undefined))).toBe(false);
    });

    it("denies even a request that sends some Bearer token", () => {
      delete process.env.CRON_API_KEY;
      expect(validateInternalSecret(ctx("Bearer anything"))).toBe(false);
    });

    it("denies when configured as an empty string", () => {
      process.env.CRON_API_KEY = "";
      expect(validateInternalSecret(ctx(undefined))).toBe(false);
      expect(validateInternalSecret(ctx("Bearer "))).toBe(false);
    });
  });

  describe("when CRON_API_KEY is configured", () => {
    beforeEach(() => {
      process.env.CRON_API_KEY = "s3cr3t-cron-key";
    });

    it("denies a request with no Authorization header", () => {
      expect(validateInternalSecret(ctx(undefined))).toBe(false);
    });

    it("denies a wrong secret", () => {
      expect(validateInternalSecret(ctx("Bearer wrong"))).toBe(false);
    });

    it("accepts the correct secret with the Bearer prefix", () => {
      expect(validateInternalSecret(ctx("Bearer s3cr3t-cron-key"))).toBe(true);
    });

    it("accepts the correct secret sent raw (no Bearer prefix)", () => {
      expect(validateInternalSecret(ctx("s3cr3t-cron-key"))).toBe(true);
    });

    it("denies a value of a different length without throwing (constant-time path)", () => {
      expect(validateInternalSecret(ctx("Bearer short"))).toBe(false);
    });
  });
});
