import type { WebhookSpendDeliveryRequest } from "@langwatch/webhook-contract";

/** One gateway request's admitted and confirmed steps, as gateway hands them to webhook. */
export function spendSteps({
  organizationId,
  projectId,
  requestId,
  admittedAt,
}: {
  organizationId: string;
  projectId: string;
  requestId: string;
  admittedAt: number;
}): { admitted: WebhookSpendDeliveryRequest; confirmed: WebhookSpendDeliveryRequest } {
  const attribution = {
    organization_id: organizationId,
    virtual_key_id: "virtual-key-1",
    principal_user_id: "user-1",
    end_user_id: "",
    model: "gpt-5-mini",
    model_provider_id: "provider-1",
    trace_id: "trace-1",
    request_type: "chat",
    labels: [],
    metadata: "",
  };

  return {
    admitted: {
      sourceEventId: `${projectId}:${requestId}:admitted`,
      spend: {
        type: "lw.gateway.spend.admitted",
        data: {
          ...attribution,
          gateway_request_id: requestId,
          occurred_at: admittedAt,
          tenantId: projectId,
          outcome_carries_attribution: false,
        },
      },
    },
    confirmed: {
      sourceEventId: `${projectId}:${requestId}:confirmed`,
      spend: {
        type: "lw.gateway.spend.confirmed",
        data: {
          ...attribution,
          gateway_request_id: requestId,
          occurred_at: admittedAt + 1_000,
          tenantId: projectId,
          admitted_at: admittedAt,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_creation_1h_tokens: 0,
            reasoning_tokens: 0,
            input_audio_tokens: 0,
            output_audio_tokens: 0,
            input_chars: 0,
            audio_ms: 0,
            input_image_tokens: 0,
            output_image_tokens: 0,
            image_count: 0,
          },
          cost_nano_usd: 4_262_500,
          rate_version: "rates-1",
          duration_ms: 1_000,
        },
      },
    },
  };
}
