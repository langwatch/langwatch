/**
 * @see specs/security/api-endpoint-authorization.feature — the fail-open guard:
 * an unset secret made `header === secret` read `undefined === undefined` as
 * true, accepting credential-less requests to destructive cron jobs.
 */
import { describe, expect, it } from "vitest";
import { isInternalSecretValid } from "../internal-secret.ts";

const valid = (authorizationHeader: string | undefined, expected: string | undefined) =>
  isInternalSecretValid({ authorizationHeader, expected });

describe("isInternalSecretValid", () => {
  describe("when the internal secret is not configured", () => {
    /** @scenario "An unset internal secret denies all callers" */
    it("denies a credential-less request, which is the fail-open regression", () => {
      expect(valid(undefined, undefined)).toBe(false);
    });

    it("denies even a request that sends some bearer token", () => {
      expect(valid("Bearer anything", undefined)).toBe(false);
    });

    it("denies when configured as an empty string", () => {
      expect(valid(undefined, "")).toBe(false);
      expect(valid("Bearer ", "")).toBe(false);
    });
  });

  describe("when the internal secret is configured", () => {
    const secret = "s3cr3t-cron-key";

    it("denies a request with no Authorization header", () => {
      expect(valid(undefined, secret)).toBe(false);
    });

    it("denies a wrong secret", () => {
      expect(valid("Bearer wrong", secret)).toBe(false);
    });

    it("accepts the correct secret with the Bearer prefix", () => {
      expect(valid(`Bearer ${secret}`, secret)).toBe(true);
    });

    it("accepts the correct secret sent raw, with no Bearer prefix", () => {
      expect(valid(secret, secret)).toBe(true);
    });

    it("denies a value of a different length without throwing, which is the constant-time path", () => {
      expect(valid("Bearer short", secret)).toBe(false);
    });
  });
});
