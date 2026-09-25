import { gatewaySpendEventEnvelopeSchema } from "@langwatch/gateway-contract";
import { Temporal } from "@langwatch/time";
import {
  webhookEnvelopeFromSpendRow,
  type WebhookSpendEventRow,
} from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

function row(overrides: Partial<WebhookSpendEventRow> = {}): WebhookSpendEventRow {
  return {
    tenantId: "project-1",
    gatewayRequestId: "req-1",
    organizationId: "org-1",
    teamId: "",
    virtualKeyId: "vk-1",
    principalUserId: "",
    endUserId: "end-user-1",
    traceId: "trace-1",
    model: "gpt-5-mini",
    providerKey: "openai",
    requestType: "chat",
    tokensInput: 10,
    tokensOutput: 20,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    tokensReasoning: 0,
    tokensInputImage: 3,
    tokensOutputImage: 4,
    imageCount: 1,
    costNanoUsd: 1_500,
    costUsd: "0.0000015",
    rateVersion: "rate-1",
    status: "confirmed",
    errorClass: "",
    httpStatus: 0,
    needsReconciliation: false,
    settleReason: "",
    labels: ["billing"],
    metadata: "",
    durationMs: 42,
    occurredAt: Temporal.Instant.fromEpochMilliseconds(1_782_864_000_000),
    ...overrides,
  };
}

describe("Feature: Gateway spend reconciliation REST surface", () => {
  describe("given the envelope the pull publishes", () => {
    describe("when a confirmed spend row is rendered", () => {
      /** @scenario "The pulled envelope publishes every field the webhook delivers" */
      it("keeps every field the webhook delivers, identity and rate version included", () => {
        const envelope = gatewaySpendEventEnvelopeSchema.parse(webhookEnvelopeFromSpendRow(row()));

        expect(envelope.data).toMatchObject({
          event_id: "req-1:completed",
          gateway_request_id: "req-1",
          organization_id: "org-1",
          end_user_id: "end-user-1",
          status: "success",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            input_image_tokens: 3,
            output_image_tokens: 4,
            image_count: 1,
          },
          cost: { total_usd: "0.0000015", nano_usd: 1_500, rate_version: "rate-1" },
          duration_ms: 42,
          labels: ["billing"],
        });
      });
    });

    describe("when a settled spend row is rendered", () => {
      it("parses with its quantities null", () => {
        const envelope = gatewaySpendEventEnvelopeSchema.parse(
          webhookEnvelopeFromSpendRow(row({ status: "settled", settleReason: "timeout" })),
        );

        expect(envelope.data).toMatchObject({
          usage: null,
          cost: null,
          needs_reconciliation: true,
          settle_reason: "timeout",
        });
      });
    });

    describe("when the document is generated", () => {
      it("publishes the typed data fields main published", () => {
        const published = z.toJSONSchema(gatewaySpendEventEnvelopeSchema, { io: "output" });
        const data = z
          .object({
            properties: z.object({
              data: z.object({ properties: z.record(z.string(), z.unknown()) }),
            }),
          })
          .parse(published).properties.data.properties;

        expect(Object.keys(data)).toEqual(
          expect.arrayContaining([
            "event_id",
            "event_type",
            "gateway_request_id",
            "occurred_at",
            "usage",
            "cost",
            "status",
            "needs_reconciliation",
            "settle_reason",
            "error",
            "duration_ms",
            "labels",
            "metadata",
          ]),
        );
      });
    });
  });
});
