/**
 * Unit tests for the ADR-075 Class C (retired; ground now ADR-098)
 * `gatewayBudgetDebits` map projection.
 *
 * The derivation is the half of the conversion that has to be REPRODUCIBLE:
 * replay re-runs `map` over the same events and the debits it produces must be
 * the ones already in the ledger, byte for byte. Anything non-deterministic
 * here (ingest time, a wall clock, a mutable default) turns a rebuild into a
 * second, different set of debits.
 */

import { spanNormalizationPipelineService } from "@ee/governance/services/spanDerivation.composition";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSpanReceivedEvent,
  type TestSpanReceivedEventOptions,
} from "~/server/event-sourcing.old/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import {
  type GatewayBudgetDebitRecord,
  GatewayBudgetDebitsMapProjection,
  spanCarriesGatewayVirtualKeyId,
} from "../gatewayBudgetDebits.mapProjection";

const noopStore = {
  append: async () => {},
} as never;

/** Custom per-token rates make the priced cost deterministic without the catalog. */
const PRICED = {
  "langwatch.model.inputCostPerToken": 0.000005,
  "langwatch.model.outputCostPerToken": 0.000015,
  "gen_ai.usage.input_tokens": 100,
  "gen_ai.usage.output_tokens": 50,
  "gen_ai.request.model": "gpt-5-mini",
} as const;

const GATEWAY_MARKERS = {
  "langwatch.virtual_key_id": "vk-1",
  "langwatch.gateway_request_id": "grq_01H",
} as const;

function mapRecord(
  options: TestSpanReceivedEventOptions = {},
): GatewayBudgetDebitRecord | null {
  const projection = new GatewayBudgetDebitsMapProjection({ store: noopStore });
  return projection.mapTraceSpanReceived(createSpanReceivedEvent(options));
}

function gatewaySpan(
  extra: Record<string, string | number | boolean> = {},
  options: TestSpanReceivedEventOptions = {},
): TestSpanReceivedEventOptions {
  return {
    ...options,
    attributes: { ...PRICED, ...GATEWAY_MARKERS, ...extra },
  };
}

describe("GatewayBudgetDebitsMapProjection", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("given a span that carries no gateway markers", () => {
    it("derives no debit", () => {
      expect(mapRecord({ attributes: PRICED })).toBeNull();
    });

    /**
     * The whole span stream passes through here, and normalisation is not
     * free: it opens a tracer span and runs every canonicalisation extractor
     * over the full attribute set, prompts and completions included. A
     * non-gateway span must be rejected on the raw wire attributes, before
     * any of that runs — returning null afterwards has already paid the bill.
     */
    it("never normalises it", () => {
      const normalize = vi.spyOn(
        spanNormalizationPipelineService,
        "normalizeSpanReceived",
      );

      mapRecord({ attributes: PRICED });

      expect(normalize).not.toHaveBeenCalled();
    });
  });

  describe("given a span that does carry a gateway virtual key", () => {
    it("normalises it, so the raw gate cannot be starving the derivation", () => {
      const normalize = vi.spyOn(
        spanNormalizationPipelineService,
        "normalizeSpanReceived",
      );

      mapRecord(gatewaySpan());

      expect(normalize).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a span carrying only a virtual key id", () => {
    it("derives no debit, because the ledger's idempotency key is incomplete", () => {
      expect(
        mapRecord({
          attributes: { ...PRICED, "langwatch.virtual_key_id": "vk-1" },
        }),
      ).toBeNull();
    });
  });

  describe("given a span carrying only a gateway request id", () => {
    it("derives no debit, because no key can be charged", () => {
      expect(
        mapRecord({
          attributes: { ...PRICED, "langwatch.gateway_request_id": "grq_01H" },
        }),
      ).toBeNull();
    });
  });

  describe("given a gateway span with provider-reported usage", () => {
    it("prices the debit from that span's own tokens", () => {
      const record = mapRecord(gatewaySpan());

      // 100 * 5e-6 + 50 * 15e-6 = 0.00125
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

    it("serialises the amount as a fixed-point decimal ClickHouse accepts", () => {
      expect(mapRecord(gatewaySpan())?.amountUsd).toMatch(/^\d+\.\d{10}$/);
    });

    it("prefers the response model over the requested one", () => {
      const record = mapRecord(
        gatewaySpan({ "gen_ai.response.model": "gpt-5-mini-2026-01-01" }),
      );
      expect(record?.model).toBe("gpt-5-mini-2026-01-01");
    });

    it("names the model 'unknown' when the span resolves none", () => {
      const record = mapRecord({
        attributes: {
          ...GATEWAY_MARKERS,
          "gen_ai.usage.input_tokens": 100,
          "gen_ai.usage.output_tokens": 50,
        },
      });
      expect(record?.model).toBe("unknown");
    });
  });

  describe("given a gateway span whose provider call failed", () => {
    it("records the debit as a provider error rather than dropping it", () => {
      const record = mapRecord(gatewaySpan({}, { statusCode: 2 }));
      expect(record?.status).toBe("PROVIDER_ERROR");
    });
  });

  describe("given a gateway span that succeeded", () => {
    it("records the debit as a success", () => {
      expect(mapRecord(gatewaySpan({}, { statusCode: 1 }))?.status).toBe(
        "SUCCESS",
      );
    });
  });

  /**
   * Which provider-filtered budgets a request may move is decided downstream
   * from this field, so a dispatch whose provider the gateway did not report
   * must read as "unknown" rather than as any particular provider.
   */
  describe("given the gateway reported which provider it dispatched to", () => {
    it("carries the provider onto the debit", () => {
      const record = mapRecord(
        gatewaySpan({ "langwatch.model_provider_id": "openai" }),
      );
      expect(record?.providerKey).toBe("openai");
    });
  });

  describe("given the gateway reported no provider", () => {
    it("leaves the debit's provider unknown rather than guessing one", () => {
      expect(mapRecord(gatewaySpan({}))?.providerKey).toBeNull();
    });

    it("reads an empty provider as unknown too", () => {
      const record = mapRecord(
        gatewaySpan({ "langwatch.model_provider_id": "" }),
      );
      expect(record?.providerKey).toBeNull();
    });
  });

  describe("given the ledger's period bucketing depends on business time", () => {
    it("stamps the request's own start time, never the ingest time", () => {
      const record = mapRecord(
        gatewaySpan(
          {},
          {
            startTimeUnixNano: "1700000000500000000",
            occurredAt: 1_900_000_000_000,
          },
        ),
      );
      expect(record?.occurredAt.getTime()).toBe(1_700_000_000_500);
    });

    it("carries the request's wall-clock duration in whole milliseconds", () => {
      expect(mapRecord(gatewaySpan())?.durationMs).toBe(2000);
    });
  });

  describe("given the same event is derived twice", () => {
    it("produces an identical debit, so a rebuild cannot diverge from the ledger", () => {
      const options = gatewaySpan();
      expect(mapRecord(options)).toEqual(mapRecord(options));
    });

    it("keys both derivations on the same gateway request id", () => {
      const options = gatewaySpan();
      expect(mapRecord(options)?.gatewayRequestId).toBe(
        mapRecord(options)?.gatewayRequestId,
      );
    });
  });

  describe("given two gateway requests share one trace", () => {
    it("derives a separate debit per request instead of merging them", () => {
      const first = mapRecord(
        gatewaySpan({ "langwatch.gateway_request_id": "grq_A" }),
      );
      const second = mapRecord(
        gatewaySpan(
          { "langwatch.gateway_request_id": "grq_B" },
          { spanId: "bbbb000000000002" },
        ),
      );

      expect(first?.gatewayRequestId).toBe("grq_A");
      expect(second?.gatewayRequestId).toBe("grq_B");
      expect(first?.amountUsd).toBe(second?.amountUsd);
    });
  });

  /**
   * The gate is also the subscriber's ADR-069 (retired; ground now ADR-098)
   * enqueue filter, a seam with no
   * retry: a throw there loses the job outright rather than reading as "not
   * relevant". So it has to survive whatever the wire hands it.
   */
  describe("given the raw gate is handed malformed wire data", () => {
    it("reads it as not-gateway instead of throwing", () => {
      for (const span of [
        undefined,
        null,
        "not-a-span",
        {},
        { attributes: null },
        { attributes: "nope" },
        { attributes: [null, undefined, "x", 7] },
        { attributes: [{ notAKey: 1 }] },
      ]) {
        expect(spanCarriesGatewayVirtualKeyId(span)).toBe(false);
      }
    });

    it("recognises the marker by key alone, whatever the value looks like", () => {
      expect(
        spanCarriesGatewayVirtualKeyId({
          attributes: [{ key: "langwatch.virtual_key_id", value: undefined }],
        }),
      ).toBe(true);
    });
  });

  describe("given the projection is registered on the pipeline", () => {
    it("subscribes only to span_received", () => {
      const projection = new GatewayBudgetDebitsMapProjection({
        store: noopStore,
      });
      expect(projection.eventTypes).toEqual(["lw.obs.trace.span_received"]);
    });

    it("routes each request to its own queue group so debits never serialise behind a trace", () => {
      const projection = new GatewayBudgetDebitsMapProjection({
        store: noopStore,
      });
      const groupKeyFn = projection.options.groupKeyFn;
      expect(groupKeyFn({ id: "evt-1" })).not.toBe(groupKeyFn({ id: "evt-2" }));
    });
  });
});
