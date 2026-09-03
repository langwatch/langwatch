// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { WebhookEndpointValidationError } from "@langwatch/enterprise-webhook-contract";
import { describe, expect, it } from "vitest";
import {
  WEBHOOK_BATCH_DELAY_BOUNDS_MS,
  WEBHOOK_IN_FLIGHT_BOUNDS,
  WEBHOOK_MAX_BATCH_SIZE_BOUNDS,
  WebhookEndpointPolicyService,
} from "../webhook-endpoint-policy.service";

describe("webhook delivery control bounds", () => {
  /** @scenario Out of bounds delivery controls are rejected with the bound in the error */
  it("rejects out-of-bounds values naming the allowed range", () => {
    const policy = WebhookEndpointPolicyService.create();

    expect(() =>
      policy.assertValidDeliveryControls({
        maxBatchSize: WEBHOOK_MAX_BATCH_SIZE_BOUNDS.max + 1,
      }),
    ).toThrow(
      `between ${WEBHOOK_MAX_BATCH_SIZE_BOUNDS.min} and ${WEBHOOK_MAX_BATCH_SIZE_BOUNDS.max}`,
    );

    expect(() =>
      policy.assertValidDeliveryControls({ maxBatchDelayMs: -1 }),
    ).toThrow(
      `between ${WEBHOOK_BATCH_DELAY_BOUNDS_MS.min} and ${WEBHOOK_BATCH_DELAY_BOUNDS_MS.max}`,
    );
    expect(() =>
      policy.assertValidDeliveryControls({
        maxInFlight: WEBHOOK_IN_FLIGHT_BOUNDS.max + 1,
      }),
    ).toThrow(
      `between ${WEBHOOK_IN_FLIGHT_BOUNDS.min} and ${WEBHOOK_IN_FLIGHT_BOUNDS.max}`,
    );
    expect(() =>
      policy.assertValidDeliveryControls({ maxBatchSize: 2.5 }),
    ).toThrow(WebhookEndpointValidationError);
  });

  it("accepts every value on the bounds themselves", () => {
    const policy = WebhookEndpointPolicyService.create();

    expect(() =>
      policy.assertValidDeliveryControls({
        maxBatchSize: WEBHOOK_MAX_BATCH_SIZE_BOUNDS.min,
        maxBatchDelayMs: WEBHOOK_BATCH_DELAY_BOUNDS_MS.max,
        maxInFlight: WEBHOOK_IN_FLIGHT_BOUNDS.max,
      }),
    ).not.toThrow();
  });
});
