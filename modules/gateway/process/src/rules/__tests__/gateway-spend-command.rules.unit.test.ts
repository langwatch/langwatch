import {
  gatewayInternalSpendCommandSchema,
  type GatewayPricedSpend,
} from "@langwatch/gateway-contract";
import { describe, expect, it } from "vitest";

import {
  attributedIdentity,
  pricedSpendCommandData,
  rejectedRecordIdentity,
} from "../gateway-spend-command.rules.ts";

describe("pricedSpendCommandData", () => {
  it("states a self-priced outcome with no admission, key or provider, priced as given", () => {
    const input = {
      requestId: "req-1",
      occurredAt: 1_700_000_000_000,
      projectId: "project-1",
      organizationId: "org-1",
      teamId: "team-1",
      model: "judge-model",
      inputTokens: 12,
      rateVersion: "v7",
      requestType: "evaluation",
      costNanoUsd: 42,
    } as GatewayPricedSpend;
    expect(pricedSpendCommandData(input)).toMatchInlineSnapshot(`
      {
        "admitted_at": 0,
        "cost_nano_usd": 42,
        "duration_ms": 0,
        "end_user_id": "",
        "gateway_request_id": "req-1",
        "labels": [],
        "metadata": "",
        "model": "judge-model",
        "model_provider_id": "",
        "occurred_at": 1700000000000,
        "organization_id": "org-1",
        "principal_user_id": "",
        "rate_version": "v7",
        "request_type": "evaluation",
        "team_id": "team-1",
        "tenantId": "project-1",
        "trace_id": "",
        "usage": {
          "audio_ms": 0,
          "cache_creation_1h_tokens": 0,
          "cache_creation_input_tokens": 0,
          "cache_read_input_tokens": 0,
          "image_count": 0,
          "input_audio_tokens": 0,
          "input_chars": 0,
          "input_image_tokens": 0,
          "input_tokens": 12,
          "output_audio_tokens": 0,
          "output_image_tokens": 0,
          "output_tokens": 0,
          "reasoning_tokens": 0,
        },
        "virtual_key_id": "",
      }
    `);
  });
});

describe("rejectedRecordIdentity", () => {
  it("names the request and tenant when the payload carries them, null otherwise", () => {
    const record = gatewayInternalSpendCommandSchema.parse({
      command: "confirmSpend",
      pod_id: "pod-1",
      pod_seq: 1,
      payload: { gateway_request_id: "req-1", project_id: 7 },
    });
    expect(rejectedRecordIdentity(record)).toEqual({ gatewayRequestId: "req-1", tenantId: null });
  });
});

describe("attributedIdentity", () => {
  it("reads the ids an attributed record carries, empty where a field is absent", () => {
    expect(
      attributedIdentity({ gateway_request_id: "req-1", virtual_key_id: 5, tenantId: "p" }),
    ).toEqual({ gatewayRequestId: "req-1", virtualKeyId: "5", projectId: "p", organizationId: "" });
  });
});
