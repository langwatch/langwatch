import type { GatewayRealtimeSessionRecord } from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import {
  settlementSpanAttributes,
  settlementSpanId,
} from "../gateway-realtime-settlement-span.rules.ts";
import { EMPTY_SPEND_USAGE } from "../gateway-spend-projection.rules.ts";

describe("settlementSpanId", () => {
  it("derives one stable 16-hex id per session, so a replayed settlement rewrites the same span", () => {
    expect(settlementSpanId("session-1")).toBe(settlementSpanId("session-1"));
    expect(settlementSpanId("session-1")).not.toBe(settlementSpanId("session-2"));
    expect(settlementSpanId("session-1")).toMatchInlineSnapshot(`"9682e5ee966982f5"`);
  });
});

describe("settlementSpanAttributes", () => {
  it("names the model, vendor, cost and usage under the canonical keys", () => {
    const session = {
      id: "session-1",
      vendor: "openai",
      model: "gpt-realtime-billing",
      requestedModel: "",
      virtualKeyId: "vk-1",
    } as GatewayRealtimeSessionRecord;
    expect(
      settlementSpanAttributes({
        session,
        usage: { ...EMPTY_SPEND_USAGE, input_tokens: 10, output_audio_tokens: 4, audio_ms: 2500 },
        costNanoUsd: 1_500_000_000,
      }),
    ).toMatchInlineSnapshot(`
      [
        {
          "key": "langwatch.span.type",
          "value": {
            "stringValue": "llm",
          },
        },
        {
          "key": "gen_ai.request.model",
          "value": {
            "stringValue": "gpt-realtime-billing",
          },
        },
        {
          "key": "gen_ai.provider.name",
          "value": {
            "stringValue": "openai",
          },
        },
        {
          "key": "langwatch.span.cost",
          "value": {
            "doubleValue": 1.5,
          },
        },
        {
          "key": "gen_ai.usage.input_tokens",
          "value": {
            "doubleValue": 10,
          },
        },
        {
          "key": "gen_ai.usage.output_tokens",
          "value": {
            "doubleValue": 0,
          },
        },
        {
          "key": "gen_ai.usage.input_audio_tokens",
          "value": {
            "doubleValue": 0,
          },
        },
        {
          "key": "gen_ai.usage.output_audio_tokens",
          "value": {
            "doubleValue": 4,
          },
        },
        {
          "key": "gen_ai.usage.audio_seconds",
          "value": {
            "doubleValue": 2.5,
          },
        },
        {
          "key": "langwatch.virtual_key_id",
          "value": {
            "stringValue": "vk-1",
          },
        },
        {
          "key": "langwatch.gateway_request_id",
          "value": {
            "stringValue": "session-1",
          },
        },
      ]
    `);
  });
});
