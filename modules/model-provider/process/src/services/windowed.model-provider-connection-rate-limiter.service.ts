import { ModelProviderTestRateLimitedError } from "@langwatch/model-provider-contract";
import { nowInstant } from "@langwatch/time";

import {
  ModelProviderConnectionRateLimiter,
  type ModelProviderRateLimit,
} from "../app/model-provider.members.ts";

/** Generous for a person clicking "test connection", ungenerous for a loop that could get an
 * organization's key rate-limited by the provider. */
const ORGANIZATION_WINDOW = { windowSeconds: 60, max: 20 } as const;

/** Bounds the deployment as a whole, so one organization's loop can't exhaust outbound capacity
 * for everyone else. */
const GLOBAL_WINDOW = { windowSeconds: 60, max: 500 } as const;

/**
 * The connection-test limiter, counted wherever the process counts. Both windows are checked in
 * order, organization first, so a caller already over its own budget doesn't also spend the
 * deployment's.
 */
export class WindowedModelProviderConnectionRateLimiterAdapter extends ModelProviderConnectionRateLimiter {
  static create(input: {
    limiter: ModelProviderRateLimit;
  }): WindowedModelProviderConnectionRateLimiterAdapter {
    return new WindowedModelProviderConnectionRateLimiterAdapter(input.limiter);
  }

  private constructor(private readonly limiter: ModelProviderRateLimit) {
    super();
  }

  async assertAvailable(input: { organizationId: string }): Promise<void> {
    const organization = await this.limiter.consume({
      key: `model-provider-test:org:${input.organizationId}`,
      ...ORGANIZATION_WINDOW,
    });
    if (!organization.allowed) {
      throw new ModelProviderTestRateLimitedError({
        retryAfterSeconds: retryAfterSeconds(organization.resetAt),
      });
    }

    const global = await this.limiter.consume({
      key: "model-provider-test:global",
      ...GLOBAL_WINDOW,
    });
    if (!global.allowed) {
      throw new ModelProviderTestRateLimitedError({
        retryAfterSeconds: retryAfterSeconds(global.resetAt),
      });
    }
  }
}

function retryAfterSeconds(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - nowInstant().epochMilliseconds) / 1000));
}
