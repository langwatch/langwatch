import type { RateLimitAxis } from "@langwatch/contracts/agent-onboarding";
import { createLogger } from "@langwatch/observability";
import type { RateLimitConfig, RateLimitRule } from "../domain/config.js";
import {
  OnboardingRateLimitedError,
  OnboardingUnavailableError,
} from "../domain/errors.js";
import { subnetKey } from "../domain/net.js";
import { peppered } from "../domain/tokens.js";
import type { RateLimitDecision, RateLimiter } from "./ports.js";

const logger = createLogger("langwatch:ai-onboarding:rate-limit");

/**
 * Who is calling, as far as the limiter is concerned. Both are optional: a
 * request behind a misconfigured proxy has no usable address, and a client
 * is free not to send a fingerprint.
 */
export interface CallerIdentity {
  /**
   * Resolved from the trusted proxy configuration, never from a raw
   * client-supplied header — otherwise every axis but fingerprint is one
   * `X-Forwarded-For` away from useless.
   */
  ip: string | null | undefined;
  fingerprint: string | null | undefined;
}

/**
 * Meters the anonymous surface on several independent axes at once, and lets
 * the tightest one decide.
 *
 * Axes are checked tightest-first and short-circuit: a caller already blocked
 * on their own fingerprint does not also burn the shared IP budget of
 * everyone behind the same NAT.
 */
export class RateLimitGuard {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly config: RateLimitConfig,
    /** Keys are hashed, so Redis never holds a raw address or fingerprint. */
    private readonly pepper: string,
  ) {}

  /**
   * `/provision`. Fails closed: an unmetered unauthenticated account-minting
   * endpoint is exactly the state an abuser waits for, and provisioning is
   * not important enough to serve without a working limiter.
   */
  async guardProvision(identity: CallerIdentity): Promise<void> {
    const axes: Array<{
      axis: RateLimitAxis;
      key: string | null | undefined;
      rules: RateLimitRule[];
    }> = [
      {
        axis: "fingerprint",
        // An absent — or empty — fingerprint means this axis does not apply.
        // Hashing "" would put every fingerprint-less caller in the world into
        // one shared bucket, so the first of them to be refused would refuse
        // all the rest.
        key: identity.fingerprint,
        rules: this.config.fingerprint,
      },
      { axis: "ip", key: identity.ip, rules: this.config.ip },
      {
        axis: "ip_subnet",
        key: identity.ip ? subnetKey(identity.ip) : null,
        rules: this.config.ipSubnet,
      },
      { axis: "global", key: "all", rules: this.config.global },
    ];

    for (const { axis, key, rules } of axes) {
      if (!key) continue;
      await this.enforce({ axis, key, rules, failOpen: false });
    }
  }

  /**
   * `/claim/*`. Fails open, unlike provisioning: claiming already requires a
   * token that proves possession, and locking an owner out of their own data
   * on day 29 because Redis is down is worse than the abuse it would stop.
   */
  async guardClaim(identity: CallerIdentity): Promise<void> {
    if (!identity.ip) return;
    await this.enforce({
      axis: "claim_ip",
      key: identity.ip,
      rules: this.config.claimIp,
      failOpen: true,
    });
  }

  /**
   * Called after a claim attempt presented a token that did not resolve.
   * Guessing a 256-bit token is hopeless on paper; this is what stops trying
   * anyway from being free.
   */
  async recordClaimFailure(identity: CallerIdentity): Promise<void> {
    if (!identity.ip) return;
    await this.enforce({
      axis: "claim_failure",
      key: identity.ip,
      rules: this.config.claimFailure,
      failOpen: true,
    });
  }

  private async enforce(params: {
    axis: RateLimitAxis;
    key: string;
    rules: RateLimitRule[];
    failOpen: boolean;
  }): Promise<void> {
    const hashed = peppered(params.key, this.pepper);

    for (const rule of params.rules) {
      const decision = await this.consumeOne({
        axis: params.axis,
        hashed,
        rule,
        failOpen: params.failOpen,
      });

      // A null decision means the store was unreachable on a fail-open axis:
      // nothing was counted, and nothing should be refused.
      if (decision === null) return;

      if (!decision.allowed) {
        throw new OnboardingRateLimitedError({
          axis: params.axis,
          retryAfterSeconds: decision.retryAfterSeconds,
        });
      }
    }
  }

  /** One bucket. Null when a fail-open axis could not reach its store. */
  private async consumeOne(params: {
    axis: RateLimitAxis;
    hashed: string;
    rule: RateLimitRule;
    failOpen: boolean;
  }): Promise<RateLimitDecision | null> {
    try {
      return await this.limiter.consume({
        key: `${params.axis}:${params.rule.windowSeconds}:${params.hashed}`,
        windowSeconds: params.rule.windowSeconds,
        max: params.rule.max,
      });
    } catch (error) {
      if (params.failOpen) {
        logger.warn(
          { axis: params.axis, error },
          "rate limiter unavailable, allowing claim-path request",
        );
        return null;
      }
      logger.error(
        { axis: params.axis, error },
        "rate limiter unavailable, refusing provisioning",
      );
      throw new OnboardingUnavailableError(
        error instanceof Error ? error : void 0,
      );
    }
  }
}
