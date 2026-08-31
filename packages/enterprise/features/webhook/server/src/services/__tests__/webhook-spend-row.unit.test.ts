// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Turning a priced gateway outcome into the spend row a webhook carries.
 *
 * Two things here are worth guarding. The money is carried as integer
 * nano-USD and rendered to a decimal string, and it must render exactly:
 * this is the number a customer reconciles against their own billing, so a
 * rounded fraction or a dropped smallest unit is a wrong invoice, not a
 * display bug.
 *
 * The other is that every attributed column has to be present even when the
 * outcome never saw an admission. A row missing them is not "unattributed" to
 * the spend log — it is malformed.
 */

import { describe, expect, it } from "vitest";
import { WebhookDeliveryService } from "../webhook-delivery.service";

const row = (over: Record<string, unknown> = {}) =>
  WebhookDeliveryService.payloadToRow({
    gateway_request_id: "request-1",
    project_id: "project-1",
    status: "confirmed",
    occurred_at: 1_700_000_000_000,
    attribution: {
      organization_id: "organization-1",
      virtual_key_id: "vk-1",
      principal_user_id: "user-1",
      end_user_id: "end-user-1",
      model: "admitted-model",
      model_provider_id: "admitted-provider",
      trace_id: "trace-1",
      request_type: "chat",
      labels: ["a"],
      metadata: "{}",
      admitted_at: 1_699_999_000_000,
    },
    model: "resolved-model",
    model_provider_id: "resolved-provider",
    usage: null,
    cost_nano_usd: 0,
    rate_version: "v1",
    duration_ms: 120,
    error: null,
    settle_reason: null,
    ...over,
  } as never);

describe("WebhookDeliveryService.payloadToRow", () => {
  describe("the money", () => {
    const costUsd = (nano: number) => row({ cost_nano_usd: nano }).costUsd;

    it("renders nothing as a plain zero", () => {
      expect(costUsd(0)).toBe("0");
    });

    it("renders a whole dollar without a decimal part", () => {
      expect(costUsd(1_000_000_000)).toBe("1");
    });

    it("renders a fraction without trailing zeros", () => {
      expect(costUsd(1_500_000_000)).toBe("1.5");
      expect(costUsd(1_100_000_000)).toBe("1.1");
    });

    it("keeps the smallest unit, rather than rounding it away", () => {
      // A nano-USD is the ledger's atom. Rounding it to zero here would make
      // a cheap request look free.
      expect(costUsd(1)).toBe("0.000000001");
    });

    it("renders a large amount exactly, where dividing would not", () => {
      // Why the conversion is integer arithmetic and not a divide: at around
      // nine million dollars of spend the quotient needs more significant
      // digits than a double carries, and `value / 1e9` answers
      // "8999999.999999998" — a different amount from the one billed.
      expect(costUsd(8_999_999_999_999_999)).toBe("8999999.999999999");
    });

    it("carries the integer alongside the string, so nothing has to parse it back", () => {
      expect(row({ cost_nano_usd: 1_500_000_000 })).toMatchObject({
        costNanoUsd: 1_500_000_000,
        costUsd: "1.5",
      });
    });
  });

  describe("given an outcome that never saw an admission", () => {
    it("still fills every attributed column, because a spend row needs them all", () => {
      expect(row({ attribution: null })).toMatchObject({
        organizationId: "",
        virtualKeyId: "",
        principalUserId: "",
        endUserId: "",
        traceId: "",
        requestType: "",
        labels: [],
        metadata: "",
      });
    });
  });

  describe("the model identity", () => {
    it("prefers what the outcome resolved over what admission requested", () => {
      expect(row()).toMatchObject({
        model: "resolved-model",
        providerKey: "resolved-provider",
      });
    });

    it("falls back to what admission requested when the outcome named none", () => {
      expect(row({ model: "", model_provider_id: "" })).toMatchObject({
        model: "admitted-model",
        providerKey: "admitted-provider",
      });
    });

    it("is empty when neither named one", () => {
      expect(row({ model: "", model_provider_id: "", attribution: null })).toMatchObject({
        model: "",
        providerKey: "",
      });
    });
  });

  describe("the outcome's own columns", () => {
    it("marks only a settlement as needing reconciliation", () => {
      expect(row({ status: "settled" }).needsReconciliation).toBe(true);
      expect(row({ status: "confirmed" }).needsReconciliation).toBe(false);
      expect(row({ status: "failed" }).needsReconciliation).toBe(false);
    });

    it("carries a failure's class and status", () => {
      expect(
        row({ status: "failed", error: { type: "rate_limit", http_status: 429 } }),
      ).toMatchObject({ errorClass: "rate_limit", httpStatus: 429 });
    });

    it("leaves a success's error columns empty rather than absent", () => {
      expect(row()).toMatchObject({ errorClass: "", httpStatus: 0 });
    });

    it("reads the tenant from the project the request ran in", () => {
      expect(row().tenantId).toBe("project-1");
    });

    it("dates the row from when the outcome happened", () => {
      expect(row().occurredAt).toEqual(new Date(1_700_000_000_000));
    });
  });

  describe("the usage counters", () => {
    it("are zero when the outcome carried none, rather than absent", () => {
      expect(row({ usage: null })).toMatchObject({
        tokensInput: 0,
        tokensOutput: 0,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensReasoning: 0,
      });
    });

    it("are carried through when it did", () => {
      expect(
        row({
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
            reasoning_tokens: 5,
          },
        }),
      ).toMatchObject({
        tokensInput: 10,
        tokensOutput: 20,
        tokensCacheRead: 3,
        tokensCacheWrite: 4,
        tokensReasoning: 5,
      });
    });
  });
});
