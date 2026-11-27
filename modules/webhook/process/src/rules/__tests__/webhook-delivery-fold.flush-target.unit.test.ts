/** Spec: modules/webhook/specs/webhooks.feature */
import { describe, expect, it } from "vitest";

import type { EndpointStreamState } from "../webhook-delivery-contract.rules.ts";
import { deriveEndpointFlushTarget } from "../webhook-delivery-fold.rules.ts";

function bufferedWithData(data: Record<string, unknown>): EndpointStreamState {
  return {
    pending: [
      {
        envelope: {
          id: "evt_1",
          type: "ocsf.event",
          created: "2026-11-16T16:47:29.124Z",
          schema_version: "1",
          data,
        },
        appendedAtMs: 1_794_847_649_124,
      },
    ],
  };
}

describe("deriveEndpointFlushTarget()", () => {
  describe("given a woken endpoint stream whose envelopes carry no organization_id", () => {
    /** @scenario A woken endpoint stream flushes whatever its envelopes carry */
    it("flushes the endpoint under the stream's own organisation", () => {
      const target = deriveEndpointFlushTarget({
        state: bufferedWithData({ class_uid: 6003, metadata: { uid: "trace-1" } }),
        key: "endpoint:webhookendpoint_1",
        organizationId: "org-1",
      });

      expect(target).toEqual({ endpointId: "webhookendpoint_1", organizationId: "org-1" });
    });
  });

  describe("given a woken endpoint stream with nothing buffered", () => {
    it("asks for no flush", () => {
      const target = deriveEndpointFlushTarget({
        state: { pending: [] },
        key: "endpoint:webhookendpoint_1",
        organizationId: "org-1",
      });

      expect(target).toBeNull();
    });
  });

  describe("given a request's delivery instance", () => {
    it("asks for no flush", () => {
      const target = deriveEndpointFlushTarget({
        state: bufferedWithData({ organization_id: "org-1" }),
        key: "request:evt_1",
        organizationId: "org-1",
      });

      expect(target).toBeNull();
    });
  });
});
