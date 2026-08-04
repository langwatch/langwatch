import { describe, expect, it } from "vitest";
import { RateLimitGuard } from "../app/rate-limit.guard.js";
import { defaultRateLimitConfig } from "../domain/config.js";
import {
  OnboardingRateLimitedError,
  OnboardingUnavailableError,
} from "../domain/errors.js";
import { peppered } from "../domain/tokens.js";
import { FakeRateLimiter } from "./fakes.js";

const PEPPER = "test-pepper";

function guardWith(limiter: FakeRateLimiter): RateLimitGuard {
  return new RateLimitGuard(limiter, defaultRateLimitConfig, PEPPER);
}

const caller = { ip: "203.0.113.42", fingerprint: "fp-".padEnd(20, "x") };

describe("provisioning rate limits", () => {
  describe("given a caller with an address and a fingerprint", () => {
    /** @scenario "provisioning is metered on four independent axes" */
    it("meters all four axes", async () => {
      const limiter = new FakeRateLimiter();
      await guardWith(limiter).guardProvision(caller);

      expect(new Set(limiter.axesTouched())).toEqual(
        new Set(["fingerprint", "ip", "ip_subnet", "global"]),
      );
    });

    it("meters the tightest axis first", async () => {
      const limiter = new FakeRateLimiter();
      await guardWith(limiter).guardProvision(caller);

      expect(limiter.axesTouched()[0]).toBe("fingerprint");
    });

    it("never puts a raw address or fingerprint in a bucket key", async () => {
      const limiter = new FakeRateLimiter();
      await guardWith(limiter).guardProvision(caller);

      for (const key of limiter.consumed) {
        expect(key).not.toContain(caller.ip);
        expect(key).not.toContain(caller.fingerprint);
      }
      expect(
        limiter.consumed.some((k) => k.includes(peppered(caller.ip, PEPPER))),
      ).toBe(true);
    });
  });

  describe("when the fingerprint bucket is exhausted", () => {
    /** @scenario "each axis refuses once its own budget is spent" */
    it("refuses with the axis that tripped and a retry hint", async () => {
      const limiter = new FakeRateLimiter();
      limiter.exhausted.add("fingerprint");

      const error = await guardWith(limiter)
        .guardProvision(caller)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OnboardingRateLimitedError);
      expect((error as OnboardingRateLimitedError).meta).toMatchObject({
        axis: "fingerprint",
        retryAfterSeconds: 42,
      });
    });

    /** @scenario "the tightest axis decides, and the others are not consumed" */
    it("does not also burn the shared IP budget", async () => {
      const limiter = new FakeRateLimiter();
      limiter.exhausted.add("fingerprint");

      await guardWith(limiter)
        .guardProvision(caller)
        .catch(() => void 0);

      expect(limiter.axesTouched()).not.toContain("ip");
      expect(limiter.axesTouched()).not.toContain("ip_subnet");
    });
  });

  describe("when the caller sends no fingerprint", () => {
    /** @scenario "a caller cannot escape the fingerprint axis by omitting it" */
    it("still meters the address axes", async () => {
      const limiter = new FakeRateLimiter();
      await guardWith(limiter).guardProvision({
        ip: caller.ip,
        fingerprint: null,
      });

      const axes = limiter.axesTouched();
      expect(axes).toContain("ip");
      expect(axes).toContain("ip_subnet");
      expect(axes).not.toContain("fingerprint");
    });

    it("does not drop every such caller into one shared bucket", async () => {
      const limiter = new FakeRateLimiter();
      const guard = guardWith(limiter);

      await guard.guardProvision({ ip: "198.51.100.1", fingerprint: null });
      await guard.guardProvision({ ip: "198.51.100.2", fingerprint: null });

      const ipKeys = limiter.consumed.filter((k) => k.startsWith("ip:"));
      expect(new Set(ipKeys).size).toBe(ipKeys.length);
    });
  });

  describe("when the limiter's store is unreachable", () => {
    /** @scenario "the limiter fails closed when its backing store is unavailable" */
    it("refuses provisioning rather than serving it unmetered", async () => {
      const limiter = new FakeRateLimiter();
      limiter.unavailable = true;

      await expect(
        guardWith(limiter).guardProvision(caller),
      ).rejects.toBeInstanceOf(OnboardingUnavailableError);
    });

    /** @scenario "the claim path stays open when the limiter's store is unavailable" */
    it("still lets a token-holding owner claim", async () => {
      const limiter = new FakeRateLimiter();
      limiter.unavailable = true;

      await expect(
        guardWith(limiter).guardClaim(caller),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a claim presents a token that does not resolve", () => {
    /** @scenario "a wrong claim token is metered harder than a right one" */
    it("counts the failure against its own axis", async () => {
      const limiter = new FakeRateLimiter();
      await guardWith(limiter).recordClaimFailure(caller);

      expect(limiter.axesTouched()).toEqual(["claim_failure"]);
    });

    it("refuses once that axis is spent", async () => {
      const limiter = new FakeRateLimiter();
      limiter.exhausted.add("claim_failure");

      await expect(
        guardWith(limiter).recordClaimFailure(caller),
      ).rejects.toBeInstanceOf(OnboardingRateLimitedError);
    });
  });
});
