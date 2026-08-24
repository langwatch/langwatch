import {
  WebhookEndpointValidationError,
  type WebhookDeliveryControls,
  type WebhookDestinationKind,
} from "@langwatch/enterprise-webhooks-contract";
import { WebhookDestinationService } from "./webhook-destination.service";

export type WebhookEndpointConfigurationInput = {
  allowInsecureLocalUrls?: boolean;
  allowAmbientAwsCredentials?: boolean;
};

export class WebhookEndpointConfiguration {
  private constructor(
    readonly allowInsecureLocalUrls: boolean,
    readonly allowAmbientAwsCredentials: boolean,
  ) {}

  static create(input: WebhookEndpointConfigurationInput = {}): WebhookEndpointConfiguration {
    return new WebhookEndpointConfiguration(
      input.allowInsecureLocalUrls ?? false,
      input.allowAmbientAwsCredentials ?? false,
    );
  }
}

export const WEBHOOK_AUTO_DISABLE_AFTER_MS = 72 * 60 * 60 * 1000;
export const WEBHOOK_DISABLED_REASON_AUTO = "auto_failures_72h";
export const WEBHOOK_DISABLED_REASON_MANUAL = "manual";
export const WEBHOOK_MAX_BATCH_SIZE_BOUNDS = { min: 1, max: 100 } as const;
export const WEBHOOK_BATCH_DELAY_BOUNDS_MS = { min: 0, max: 60_000 } as const;
export const WEBHOOK_IN_FLIGHT_BOUNDS = { min: 1, max: 8 } as const;

function assertControlInBounds(
  name: string,
  value: number,
  bounds: { min: number; max: number },
): void {
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new WebhookEndpointValidationError(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}`,
    );
  }
}

export class WebhookEndpointPolicyService {
  private constructor(
    private readonly destinations: WebhookDestinationService,
  ) {}

  static create(): WebhookEndpointPolicyService {
    return new WebhookEndpointPolicyService(WebhookDestinationService.create());
  }

  assertValidDeliveryControls(
    controls: Partial<WebhookDeliveryControls>,
  ): void {
    if (controls.maxBatchSize !== undefined) {
      assertControlInBounds(
        "max_batch_size",
        controls.maxBatchSize,
        WEBHOOK_MAX_BATCH_SIZE_BOUNDS,
      );
    }
    if (controls.maxBatchDelayMs !== undefined) {
      assertControlInBounds(
        "max_batch_delay_ms",
        controls.maxBatchDelayMs,
        WEBHOOK_BATCH_DELAY_BOUNDS_MS,
      );
    }
    if (controls.maxInFlight !== undefined) {
      assertControlInBounds(
        "max_in_flight",
        controls.maxInFlight,
        WEBHOOK_IN_FLIGHT_BOUNDS,
      );
    }
  }

  describeDestination(endpoint: {
    destinationKind: WebhookDestinationKind;
    url: string | null;
    sqsQueueUrl: string | null;
  }): string {
    return this.destinations.describe(endpoint);
  }
}
