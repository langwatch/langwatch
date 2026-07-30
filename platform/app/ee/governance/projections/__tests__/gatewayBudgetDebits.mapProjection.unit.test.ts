/**
 * Unit tests for the `gatewayBudgetDebits` map (ADR-107 decision 17,
 * pre-built). Derivation has to be REPRODUCIBLE: replay re-runs it over the
 * same events and the debits it produces must match the live ledger, byte
 * for byte.
 */

import { describe, expect, it } from "vitest";
import { canonicalSpan } from "~/server/event-sourcing/trace-processing/__tests__/fixtures";
import {
  deriveGatewayDebitRecord,
  spanCarriesGatewayVirtualKeyId,
} from "../gatewayBudgetDebits.mapProjection";

const GATEWAY_MARKERS = {
  "langwatch.virtual_key_id": "vk-1",
  "langwatch.gateway_request_id": "grq_01H",
} as const;

function gatewaySpan(
  attrs: Record<string, string | number | boolean> = {},
  overrides: Parameters<typeof canonicalSpan>[0] = {},
) {
  return canonicalSpan({
    ...overrides,
    attributes: { ...GATEWAY_MARKERS, ...attrs },
  });
}

describe("spanCarriesGatewayVirtualKeyId", () => {
  it("recognises a span carrying the marker", () => {
    expect(spanCarriesGatewayVirtualKeyId(gatewaySpan())).toBe(true);
  });

  it("declines a span with no marker", () => {
    expect(
      spanCarriesGatewayVirtualKeyId(canonicalSpan({ attributes: {} })),
    ).toBe(false);
  });
});

describe("deriveGatewayDebitRecord", () => {
  it("derives no debit when only the virtual key is present", () => {
    expect(
      deriveGatewayDebitRecord(
        canonicalSpan({ attributes: { "langwatch.virtual_key_id": "vk-1" } }),
      ),
    ).toBeNull();
  });

  it("derives no debit when only the gateway request id is present", () => {
    expect(
      deriveGatewayDebitRecord(
        canonicalSpan({
          attributes: { "langwatch.gateway_request_id": "grq_01H" },
        }),
      ),
    ).toBeNull();
  });

  it("prices the debit from the span's own cost and tokens", () => {
    const record = deriveGatewayDebitRecord(
      gatewaySpan(
        {},
        {
          cost: { cost: 0.00125, nonBilledCost: null },
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            reasoningTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimated: false,
          },
          model: "gpt-5-mini",
        },
      ),
    );

    expect(record).toMatchObject({
      tenantId: "tenant-1",
      virtualKeyId: "vk-1",
      gatewayRequestId: "grq_01H",
      amountUsd: "0.0012500000",
      tokensInput: 100,
      tokensOutput: 50,
      model: "gpt-5-mini",
      status: "SUCCESS",
    });
  });

  it("names the model 'unknown' when the span resolves none", () => {
    const record = deriveGatewayDebitRecord(gatewaySpan({}, { model: null }));
    expect(record?.model).toBe("unknown");
  });

  it("records a provider error rather than dropping the debit", () => {
    const record = deriveGatewayDebitRecord(
      gatewaySpan({}, { statusCode: "ERROR" }),
    );
    expect(record?.status).toBe("PROVIDER_ERROR");
  });

  it("records a success", () => {
    const record = deriveGatewayDebitRecord(
      gatewaySpan({}, { statusCode: "OK" }),
    );
    expect(record?.status).toBe("SUCCESS");
  });

  describe("given the gateway reported which provider it dispatched to", () => {
    it("carries the provider onto the debit", () => {
      const record = deriveGatewayDebitRecord(
        gatewaySpan({ "langwatch.model_provider_id": "openai" }),
      );
      expect(record?.providerKey).toBe("openai");
    });
  });

  describe("given the gateway reported no provider", () => {
    it("leaves the debit's provider unknown rather than guessing one", () => {
      expect(deriveGatewayDebitRecord(gatewaySpan())?.providerKey).toBeNull();
    });
  });

  it("stamps the request's own start time, never the ingest time", () => {
    const record = deriveGatewayDebitRecord(
      gatewaySpan(
        {},
        { startTimeUnixMs: 1_700_000_000_500, occurredAt: 1_900_000_000_000 },
      ),
    );
    expect(record?.occurredAt.getTime()).toBe(1_700_000_000_500);
  });

  it("carries the request's wall-clock duration in whole milliseconds", () => {
    const record = deriveGatewayDebitRecord(
      gatewaySpan({}, { startTimeUnixMs: 1_000, endTimeUnixMs: 3_000 }),
    );
    expect(record?.durationMs).toBe(2_000);
  });

  it("is deterministic: re-deriving the same span produces an identical debit", () => {
    const span = gatewaySpan();
    expect(deriveGatewayDebitRecord(span)).toEqual(
      deriveGatewayDebitRecord(span),
    );
  });

  it("derives a separate debit per request when two share a trace", () => {
    const first = deriveGatewayDebitRecord(
      gatewaySpan({ "langwatch.gateway_request_id": "grq_A" }),
    );
    const second = deriveGatewayDebitRecord(
      gatewaySpan(
        { "langwatch.gateway_request_id": "grq_B" },
        { spanId: "bbbb000000000002" },
      ),
    );
    expect(first?.gatewayRequestId).toBe("grq_A");
    expect(second?.gatewayRequestId).toBe("grq_B");
  });
});
