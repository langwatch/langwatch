import { createEnterpriseWebhookEndpointService } from "~/server/webhooks/enterpriseWebhookEndpointService";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { describe, expect, it } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  assertValidDeliveryControls,
  WEBHOOK_BATCH_DELAY_BOUNDS_MS,
  WEBHOOK_IN_FLIGHT_BOUNDS,
  WEBHOOK_MAX_BATCH_SIZE_BOUNDS,
  WebhookEndpointValidationError,
} from "~/runtime/app/features/webhooks";

describe("webhook delivery control bounds", () => {
  /** @scenario Out of bounds delivery controls are rejected with the bound in the error */
  it("rejects out-of-bounds values naming the allowed range", async () => {
    // Validation throws before any prisma call; an empty object proves it.
    const service = createEnterpriseWebhookEndpointService({ prisma: {} as PrismaClient });
    await expect(
      service.create({
        organizationId: "org_test",
        url: "https://example.com/hooks",
        enabledEvents: ["gateway.request.completed"],
        maxBatchSize: WEBHOOK_MAX_BATCH_SIZE_BOUNDS.max + 1,
      }),
    ).rejects.toThrow(
      `between ${WEBHOOK_MAX_BATCH_SIZE_BOUNDS.min} and ${WEBHOOK_MAX_BATCH_SIZE_BOUNDS.max}`,
    );

    expect(() => assertValidDeliveryControls({ maxBatchDelayMs: -1 })).toThrow(
      `between ${WEBHOOK_BATCH_DELAY_BOUNDS_MS.min} and ${WEBHOOK_BATCH_DELAY_BOUNDS_MS.max}`,
    );
    expect(() =>
      assertValidDeliveryControls({
        maxInFlight: WEBHOOK_IN_FLIGHT_BOUNDS.max + 1,
      }),
    ).toThrow(
      `between ${WEBHOOK_IN_FLIGHT_BOUNDS.min} and ${WEBHOOK_IN_FLIGHT_BOUNDS.max}`,
    );
    expect(() => assertValidDeliveryControls({ maxBatchSize: 2.5 })).toThrow(
      WebhookEndpointValidationError,
    );
  });

  it("accepts every value on the bounds themselves", () => {
    expect(() =>
      assertValidDeliveryControls({
        maxBatchSize: WEBHOOK_MAX_BATCH_SIZE_BOUNDS.min,
        maxBatchDelayMs: WEBHOOK_BATCH_DELAY_BOUNDS_MS.max,
        maxInFlight: WEBHOOK_IN_FLIGHT_BOUNDS.max,
      }),
    ).not.toThrow();
  });
});
