/**
 * Unit tests for the OTel passthrough normaliser.
 *
 * Locks in the attribute mapping so future per-platform extractors
 * don't accidentally regress the generic OTel extraction. Spec-pinned
 * attribute names are the four families OpenTelemetry's GenAI semantic
 * conventions support: `gen_ai.usage.*` (current standard), the older
 * `llm.*` attribute set, and our own `langwatch.*` namespace.
 */
import type { IngestionSource } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { normalizeOtlpJson } from "../otel";

function makeSource(
  overrides: Partial<IngestionSource> = {},
): IngestionSource {
  return {
    id: "src-test",
    organizationId: "org-test",
    teamId: null,
    sourceType: "otel_generic",
    name: "test",
    description: null,
    ingestSecretHash: "h",
    parserConfig: {},
    pollerCursor: null,
    status: "active",
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: null,
    ...overrides,
  } as IngestionSource;
}

function spanWithAttrs(
  attrs: Array<[string, string | number]>,
  extras: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    resource_spans: [
      {
        resource: { attributes: [] },
        scope_spans: [
          {
            spans: [
              {
                spanId: "span1",
                traceId: "trace1",
                name: "chat.completion",
                startTimeUnixNano: "1777273800000000000",
                attributes: attrs.map(([k, v]) => ({
                  key: k,
                  value:
                    typeof v === "string"
                      ? { stringValue: v }
                      : { intValue: v },
                })),
                ...extras,
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("normalizeOtlpJson", () => {
  describe("when given the gen_ai.usage.* attribute family Alexis sent", () => {
    it("extracts cost_usd + input_tokens + output_tokens", () => {
      // Regression test for iter 16 finding: my normaliser only knew
      // gen_ai.usage.cost / gen_ai.usage.prompt_tokens, missed the
      // canonical gen_ai.usage.cost_usd / gen_ai.usage.input_tokens /
      // gen_ai.usage.output_tokens. Required by Option C spend_spike.
      const events = normalizeOtlpJson(
        makeSource(),
        spanWithAttrs([
          ["gen_ai.request.model", "claude-3-5-sonnet"],
          ["gen_ai.usage.cost_usd", "0.0042"],
          ["gen_ai.usage.input_tokens", 120],
          ["gen_ai.usage.output_tokens", 340],
        ]),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        target: "claude-3-5-sonnet",
        costUsd: "0.004200",
        tokensInput: 120,
        tokensOutput: 340,
      });
    });
  });

  describe("when given the older llm.* attribute family", () => {
    it("extracts cost.usd + token_count.prompt + token_count.completion", () => {
      const events = normalizeOtlpJson(
        makeSource(),
        spanWithAttrs([
          ["llm.model", "gpt-4o"],
          ["llm.cost.usd", "0.0019"],
          ["llm.token_count.prompt", 90],
          ["llm.token_count.completion", 210],
        ]),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        target: "gpt-4o",
        costUsd: "0.001900",
        tokensInput: 90,
        tokensOutput: 210,
      });
    });
  });

  describe("when given the gen_ai.usage.* legacy prompt_tokens variant", () => {
    it("extracts prompt_tokens / completion_tokens fallback path", () => {
      const events = normalizeOtlpJson(
        makeSource(),
        spanWithAttrs([
          ["gen_ai.usage.prompt_tokens", 50],
          ["gen_ai.usage.completion_tokens", 75],
        ]),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.tokensInput).toBe(50);
      expect(events[0]?.tokensOutput).toBe(75);
    });
  });

  describe("when no cost / token attrs are present", () => {
    it("returns 0 / 0 / undefined cleanly without throwing", () => {
      const events = normalizeOtlpJson(
        makeSource(),
        spanWithAttrs([["service.name", "my-agent"]]),
      );
      expect(events).toHaveLength(1);
      expect(events[0]?.costUsd).toBeUndefined();
      expect(events[0]?.tokensInput).toBe(0);
      expect(events[0]?.tokensOutput).toBe(0);
    });
  });

  describe("when given a malformed JSON body", () => {
    it("returns an empty array without throwing — receivers still 202-ack", () => {
      const events = normalizeOtlpJson(makeSource(), "{not valid json");
      expect(events).toEqual([]);
    });
  });
});
