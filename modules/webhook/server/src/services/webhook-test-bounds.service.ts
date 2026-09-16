import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/infrastructure/members";
import { WebhookTestRateLimitedError } from "@langwatch/webhook-contract";

/**
 * The tier-effective window the test-delivery door fires under: a test
 * dispatch leaves LangWatch egress IPs toward a third party, so it spends the
 * organization's window at the caller's plan bound.
 */
export class WebhookTestBoundsService {
  static create(deps: {
    entitlement: Pick<EntitlementApi, "requestBound">;
    rateLimiter: RateLimiter;
  }): WebhookTestBoundsService {
    return new WebhookTestBoundsService(deps);
  }

  private constructor(
    private readonly deps: Readonly<{
      entitlement: Pick<EntitlementApi, "requestBound">;
      rateLimiter: RateLimiter;
    }>,
  ) {}

  /** Counts one test fire against the organization's window, before any dispatch. */
  async assertTestFireWithinBounds(input: { organizationId: string }): Promise<void> {
    const requests = await this.deps.entitlement.requestBound({
      key: "webhookTestPerMinute",
      organizationId: input.organizationId,
    });
    const decision = await this.deps.rateLimiter.check(`webhook-test:${input.organizationId}`, {
      requests,
      seconds: 60,
    });
    if (!decision.allowed) {
      throw new WebhookTestRateLimitedError({ retryAfterSeconds: decision.retryAfterSeconds });
    }
  }
}
