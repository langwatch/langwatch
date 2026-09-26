import { describe, expect, it } from "vitest";
import type { SpendEventRow } from "~/server/gateway/spendEvents.clickhouse.repository";
import { spendRowToEnvelope } from "../envelope";

function row(overrides: Partial<SpendEventRow> = {}): SpendEventRow {
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
    tokensInput: 100,
    tokensOutput: 20,
    tokensCacheRead: 5,
    tokensCacheWrite: 3,
    tokensReasoning: 2,
    tokensInputImage: 0,
    tokensOutputImage: 0,
    imageCount: 0,
    costUsd: "0.001234",
    costNanoUsd: 1_234_000,
    rateVersion: "catalog@2026-07-26",
    status: "confirmed",
    errorClass: "",
    httpStatus: 200,
    needsReconciliation: false,
    settleReason: "",
    requestType: "chat",
    labels: ["customer:acme-172"],
    metadata: '{"call_site":"summary"}',
    durationMs: 1234,
    occurredAt: new Date("2026-07-27T14:03:11.482Z"),
    ...overrides,
  };
}

describe("spend event envelope", () => {
  /** @scenario The envelope renames the provider column to the contract field */
  it("maps ProviderKey to model_provider_id and the request id to the envelope id", () => {
    const envelope = spendRowToEnvelope(row());
    expect(envelope.id).toBe("01K1REQUESTULID:completed");
    expect(envelope.type).toBe("gateway.request.completed");
    expect(envelope.data.gateway_request_id).toBe("01K1REQUESTULID");
    expect(envelope.data.model_provider_id).toBe("provider_row_id_1");
    expect(envelope.data).not.toHaveProperty("provider_key");
    expect(envelope.data).not.toHaveProperty("ProviderKey");
  });

  it("carries the six-slot billing contract fields", () => {
    const envelope = spendRowToEnvelope(row());
    expect(envelope.created).toBe("2026-07-27T14:03:11.482Z");
    expect(envelope.schema_version).toBe("1");
    expect(envelope.data.usage).toEqual({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 5,
      cache_creation_input_tokens: 3,
      reasoning_tokens: 2,
      input_image_tokens: 0,
      output_image_tokens: 0,
      image_count: 0,
    });
    expect(envelope.data.cost).toEqual({
      total_usd: "0.001234",
      nano_usd: 1_234_000,
      rate_version: "catalog@2026-07-26",
    });
    expect(envelope.data.end_user_id).toBe("end-user-7");
    expect(envelope.data.metadata).toEqual({ call_site: "summary" });
    expect(envelope.data.occurred_at).toBe("2026-07-27T14:03:11.482Z");
  });

  it("publishes the image quantities of an image request beside zero text output", () => {
    const envelope = spendRowToEnvelope(
      row({
        model: "openai/gpt-image-2",
        requestType: "image_generation",
        tokensInput: 23,
        tokensOutput: 0,
        tokensCacheRead: 0,
        tokensCacheWrite: 0,
        tokensReasoning: 0,
        tokensInputImage: 0,
        tokensOutputImage: 158,
        imageCount: 1,
      }),
    );
    expect(envelope.data.usage).toEqual({
      input_tokens: 23,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
      input_image_tokens: 0,
      output_image_tokens: 158,
      image_count: 1,
    });
  });

  it("publishes the input image tokens and image count of an image edit", () => {
    const envelope = spendRowToEnvelope(
      row({
        model: "openai/gpt-image-2",
        requestType: "image_edit",
        tokensInput: 21,
        tokensOutput: 0,
        tokensInputImage: 1024,
        tokensOutputImage: 196,
        imageCount: 1,
      }),
    );
    const usage = envelope.data.usage as Record<string, number>;
    expect(usage.input_tokens).toBe(21);
    expect(usage.input_image_tokens).toBe(1024);
    expect(usage.output_image_tokens).toBe(196);
    expect(usage.image_count).toBe(1);
  });

  it("nulls empty attribution and collapses garbage metadata to an empty object", () => {
    const envelope = spendRowToEnvelope(
      row({
        providerKey: "",
        principalUserId: "",
        endUserId: "",
        metadata: "{oops",
      }),
    );
    expect(envelope.data.model_provider_id).toBeNull();
    expect(envelope.data.principal_user_id).toBeNull();
    expect(envelope.data.end_user_id).toBeNull();
    expect(envelope.data.metadata).toEqual({});
  });

  it("shapes the error block from the rich class on failures", () => {
    const envelope = spendRowToEnvelope(
      row({
        status: "failed",
        errorClass: "upstream_rate_limited",
        httpStatus: 429,
      }),
    );
    expect(envelope.type).toBe("gateway.request.completed");
    expect(envelope.data.status).toBe("error");
    expect(envelope.data.error).toEqual({
      class: "upstream_rate_limited",
      http_status: 429,
    });
  });

  /** @scenario A settled request is its own event type with unknown cost */
  it("settled maps to gateway.request.settled with null cost and usage", () => {
    const envelope = spendRowToEnvelope(
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

  it("the settled and completed envelopes of one request never share an id", () => {
    const settled = spendRowToEnvelope(
      row({ status: "settled", needsReconciliation: true }),
    );
    const completed = spendRowToEnvelope(row());
    expect(settled.id).not.toBe(completed.id);
    expect(settled.data.gateway_request_id).toBe(
      completed.data.gateway_request_id,
    );
  });

  /** @scenario The pull surface serves in-flight rows as admitted envelopes */
  it("maps an admitted row to gateway.request.admitted with unknowns null", () => {
    const envelope = spendRowToEnvelope(row({ status: "admitted" }));
    expect(envelope.type).toBe("gateway.request.admitted");
    expect(envelope.id.endsWith(":admitted")).toBe(true);
    expect(envelope.data.status).toBe("admitted");
    expect(envelope.data.usage).toBeNull();
    expect(envelope.data.cost).toBeNull();
    expect(envelope.data.duration_ms).toBeNull();
    expect(envelope.data.needs_reconciliation).toBeNull();
  });
});
