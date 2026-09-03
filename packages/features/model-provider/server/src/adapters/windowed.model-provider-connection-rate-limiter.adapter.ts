import { ModelProviderTestRateLimitedError } from "@langwatch/model-provider-contract";
import {
  ModelProviderConnectionRateLimiter,
  type ModelProviderRateLimitPort,
} from "../ports/model-provider.port";

/**
 * How often one organization may ask a provider whether its key still works.
 *
 * Twenty a minute is generous for a person clicking "test connection" and
 * ungenerous for a loop, which is the shape being bounded: every probe carries
 * a customer credential to a third party, and a caller that can spend the
 * organization's key at machine speed can get it rate-limited by the PROVIDER.
 */
const ORGANIZATION_WINDOW = { windowSeconds: 60, max: 20 } as const;

/**
 * The same bound for the deployment as a whole, so one organization's loop
 * cannot exhaust the process's outbound capacity for everyone else's.
 */
const GLOBAL_WINDOW = { windowSeconds: 60, max: 500 } as const;

/**
 * The connection-test limiter, counted wherever the process counts.
 *
 * The windows are the feature's — they bound a credential probe, and the
 * numbers travel with the surface that raises them — while the counter is the
 * process's, which is why it arrives as a port. Both windows are consulted in
 * order, and the organization's is charged first so a caller that is already
 * over its own budget does not also spend the deployment's.
 */
export class WindowedModelProviderConnectionRateLimiterAdapter extends ModelProviderConnectionRateLimiter {
  static create(input: {
    limiter: ModelProviderRateLimitPort;
  }): WindowedModelProviderConnectionRateLimiterAdapter {
    return new WindowedModelProviderConnectionRateLimiterAdapter(input.limiter);
  }

  private constructor(private readonly limiter: ModelProviderRateLimitPort) {
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
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}
