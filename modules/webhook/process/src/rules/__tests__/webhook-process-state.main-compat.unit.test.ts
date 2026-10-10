import { describe, expect, it } from "vitest";

import {
  webhookDeliveryStateSchema,
  webhookProcessStateSchema,
} from "../webhook-delivery-contract.rules.ts";

describe("process state stored by the main release", () => {
  it("parses a webhook delivery state as main stored it", () => {
    expect(
      webhookDeliveryStateSchema.parse({
        attribution: {
          organization_id: "o",
          virtual_key_id: "vk",
          principal_user_id: "u",
          end_user_id: "",
          model: "m",
          model_provider_id: "p",
          trace_id: "t",
          request_type: "chat",
          labels: [],
          metadata: "{}",
          admitted_at: 1,
        },
        pendingOutcome: null,
      }),
    ).toEqual({
      attribution: {
        organization_id: "o",
        virtual_key_id: "vk",
        principal_user_id: "u",
        end_user_id: "",
        model: "m",
        model_provider_id: "p",
        trace_id: "t",
        request_type: "chat",
        labels: [],
        metadata: "{}",
        admitted_at: 1,
      },
      pendingOutcome: null,
    });
  });

  it("parses an endpoint stream state as main stored it", () => {
    const stream = {
      pending: [
        {
          envelope: {
            id: "request-1:completed",
            type: "gateway.request.completed",
            created: "2026-09-27T12:00:00.000Z",
            schema_version: "1",
            data: { organization_id: "o" },
          },
          appendedAtMs: 1,
        },
      ],
    };

    expect(webhookProcessStateSchema.parse(stream)).toEqual(stream);
  });
});
