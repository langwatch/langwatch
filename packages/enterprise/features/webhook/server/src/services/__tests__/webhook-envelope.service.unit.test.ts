// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Turning a priced spend row into the envelope a webhook delivers.
 *
 * A settled row prices nothing — the confirmation never arrived — so its
 * envelope must say "unknown", not "zero". Zero looks like a free request;
 * null is the only shape that tells a receiver reconciliation is still
 * pending. The in-flight ("admitted") shape carries the same null-cost rule
 * for the same reason: the request has not finished, so nothing about its
 * usage or duration is known yet.
 */

import { describe, expect, it } from "vitest";
import { WebhookEnvelopeService, type WebhookSpendEventRow } from "../webhook-envelope.service";

function row(overrides: Partial<WebhookSpendEventRow> = {}): WebhookSpendEventRow {
  return {
    tenantId: "proj_1",
    gatewayRequestId: "01K1REQUESTULID",
    organizationId: "org_1",
    teamId: "team_1",
    virtualKeyId: "vk_1",
    principalUserId: "",
    endUserId: "end-user-7",
    traceId: "trace-1",
    model: "openai/gpt-5",
    providerKey: "provider_row_id_1",
    requestType: "chat",
    tokensInput: 100,
    tokensOutput: 20,
    tokensCacheRead: 5,
    tokensCacheWrite: 3,
    tokensReasoning: 2,
    costNanoUsd: 1_234_000,
    costUsd: "0.001234",
    rateVersion: "catalog@2026-07-26",
    status: "confirmed",
    errorClass: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    labels: ["customer:acme-172"],
    metadata: '{"call_site":"summary"}',
    durationMs: 1234,
    occurredAt: new Date("2026-07-27T14:03:11.482Z"),
    ...overrides,
  };
}

describe("WebhookEnvelopeService.fromSpendRow", () => {
  describe("given a settled row", () => {
    /** @scenario A settled request is its own event type with unknown cost */
    it("maps to gateway.request.settled with null cost and usage", () => {
      const envelope = WebhookEnvelopeService.fromSpendRow(
        row({
          status: "settled",
          needsReconciliation: true,
          settleReason: "confirmation_deadline_expired",
          costNanoUsd: 0,
          costUsd: "0.000000",
        }),
      );
      expect(envelope.type).toBe("gateway.request.settled");
      expect(envelope.id).toBe("01K1REQUESTULID:settled");
      expect(envelope.data.event_type).toBe("gateway.request.settled");
      expect(envelope.data.gateway_request_id).toBe("01K1REQUESTULID");
      expect(envelope.data.status).toBe("settled");
      expect(envelope.data.cost).toBeNull();
      expect(envelope.data.usage).toBeNull();
      expect(envelope.data.needs_reconciliation).toBe(true);
      expect(envelope.data.settle_reason).toBe("confirmation_deadline_expired");
    });

    it("never shares an id with the same request's completed envelope", () => {
      const settled = WebhookEnvelopeService.fromSpendRow(
        row({ status: "settled", needsReconciliation: true }),
      );
      const completed = WebhookEnvelopeService.fromSpendRow(row());
      expect(settled.id).not.toBe(completed.id);
      expect(settled.data.gateway_request_id).toBe(completed.data.gateway_request_id);
    });
  });

  describe("given an admitted row", () => {
    /** @scenario The pull surface serves in-flight rows as admitted envelopes */
    it("maps to gateway.request.admitted with unknowns null", () => {
      const envelope = WebhookEnvelopeService.fromSpendRow(row({ status: "admitted" }));
      expect(envelope.type).toBe("gateway.request.admitted");
      expect(envelope.id.endsWith(":admitted")).toBe(true);
      expect(envelope.data.status).toBe("admitted");
      expect(envelope.data.usage).toBeNull();
      expect(envelope.data.cost).toBeNull();
      expect(envelope.data.duration_ms).toBeNull();
      expect(envelope.data.needs_reconciliation).toBeNull();
    });
  });
});
