import { describe, expect, it } from "vitest";
import { WebhookDestinationService } from "../src/services/webhook-destination.service";
import { WebhookDeliveryService } from "../src/services/webhook-delivery.service";
import {
  WebhookEnvelopeService,
  type WebhookSpendEventRow,
} from "../src/services/webhook-envelope.service";

const spendRow = (
  overrides: Partial<WebhookSpendEventRow> = {},
): WebhookSpendEventRow => ({
  tenantId: "project_1",
  gatewayRequestId: "request_1",
  organizationId: "org_1",
  teamId: "",
  virtualKeyId: "key_1",
  principalUserId: "user_1",
  endUserId: "",
  traceId: "trace_1",
  model: "gpt-5",
  providerKey: "provider_1",
  requestType: "chat",
  tokensInput: 10,
  tokensOutput: 5,
  tokensCacheRead: 0,
  tokensCacheWrite: 0,
  tokensReasoning: 0,
  costNanoUsd: 25,
  costUsd: "0.000000025",
  rateVersion: "rates-1",
  status: "confirmed",
  errorClass: "",
  httpStatus: 0,
  needsReconciliation: false,
  settleReason: "",
  labels: [],
  metadata: "{}",
  durationMs: 12,
  occurredAt: new Date("2026-08-24T00:00:00.000Z"),
  ...overrides,
});

describe("webhook server", () => {
  it("keeps the retry ladder stable after the sixth failure", () => {
    expect(WebhookDeliveryService.retryDelayMs({ attempt: 1 })).toBe(60_000);
    expect(WebhookDeliveryService.retryDelayMs({ attempt: 99 })).toBe(12 * 60 * 60_000);
  });

  it("maps settled rows without inventing money", () => {
    const envelope = WebhookEnvelopeService.fromSpendRow(
      spendRow({ status: "settled", settleReason: "deadline" }),
    );
    expect(envelope.type).toBe("gateway.request.settled");
    expect(envelope.data).toMatchObject({
      cost: null,
      usage: null,
      needs_reconciliation: true,
      settle_reason: "deadline",
    });
  });

  it("accepts canonical standard SQS URLs and refuses FIFO", () => {
    const service = WebhookDestinationService.create();
    expect(
      service.inspectSqsQueueUrl(
        "https://sqs.eu-west-1.amazonaws.com/123456789012/events",
      ).ok,
    ).toBe(true);
    expect(
      service.inspectSqsQueueUrl(
        "https://sqs.eu-west-1.amazonaws.com/123456789012/events.fifo",
      ),
    ).toEqual({ ok: false, problem: "fifo" });
  });
});
