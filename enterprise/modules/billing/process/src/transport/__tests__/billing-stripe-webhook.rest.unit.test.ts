/**
 * @vitest-environment node
 * `POST /api/webhooks/stripe`: its address, its door, and its four answers.
 * @see enterprise/modules/billing/specs/stripe-webhook.feature
 */
import { createRestRuntime, canonicalErrorResponse } from "@langwatch/api/rest";
import type { HandleEventResult } from "@langwatch/enterprise-billing-contract";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  billingStripeWebhookRest,
  type BillingStripeWebhookApi,
} from "../billing-stripe-webhook.rest.ts";

const declaration = billingStripeWebhookRest.router();

const EVENT: Stripe.Event = {
  id: "evt_1",
  object: "event",
  type: "account.application.deauthorized",
  api_version: null,
  created: 0,
  data: { object: { id: "ca_1", object: "application", name: "Test application" } },
  livemode: false,
  pending_webhooks: 1,
  request: null,
};

const dispatchesEvents = vi.fn<() => boolean>();
const findSigningSecret = vi.fn<() => string | undefined>();
const constructEvent = vi.fn<BillingStripeWebhookApi["constructEvent"]>();
const handleEvent = vi.fn<BillingStripeWebhookApi["handleEvent"]>();

function mounted() {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("The provider callback answers with no credential resolved.");
      },
    },
  });

  return runtime.mount(declaration, {
    app: () => ({ dispatchesEvents, findSigningSecret, constructEvent, handleEvent }),
    credential: "public",
    onError: canonicalErrorResponse,
  });
}

function deliver(headers: Record<string, string> = { "stripe-signature": "t=1,v1=abc" }) {
  return mounted().request("/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: '{"id":"evt_1"}',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dispatchesEvents.mockReturnValue(true);
  findSigningSecret.mockReturnValue("whsec_test");
  constructEvent.mockReturnValue(EVENT);
  handleEvent.mockResolvedValue({ status: "ok" } satisfies HandleEventResult);
});

describe("given the provider callback declaration", () => {
  describe("when its addresses are read", () => {
    it("publishes the one path the provider's dashboard holds, and its twin", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(true);
      expect(declaration.routes.map((route) => `${route.method} ${route.path}`)).toEqual([
        "post /api/webhooks/stripe",
      ]);
    });
  });

  describe("when the door it answers behind is read", () => {
    it("resolves no credential and never parses the body it verifies", () => {
      const route = declaration.routes[0];

      expect(route?.access?.kind).toBe("public");
      expect(route?.permission).toBeUndefined();
      // The signature is computed over these bytes: a parse-then-reserialise
      // verifies nothing.
      expect(route?.rawBody).toEqual({ form: "bytes", mediaType: "application/octet-stream" });
      expect(route?.rawResponse).toBeUndefined();
      expect(route?.output.validate({ received: true })).toBe(true);
    });
  });
});

describe("given a deployment that dispatches no provider events", () => {
  describe("when a delivery arrives", () => {
    /** @scenario "A deployment with no Stripe composed answers the callback with 404" */
    it("answers not found, and verifies nothing", async () => {
      dispatchesEvents.mockReturnValue(false);

      const response = await deliver();

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.json()).toMatchObject({ code: "not_found" });
      expect(constructEvent).not.toHaveBeenCalled();
    });
  });
});

describe("given a deployment that bills through the provider", () => {
  describe("when a delivery carries no signature", () => {
    /** @scenario "A delivery with no signature is refused before anything is parsed" */
    it("refuses in the words the provider's delivery log shows an operator", async () => {
      const response = await deliver({});

      expect(response.status).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ code: "bad_request" });
      expect(handleEvent).not.toHaveBeenCalled();
    });
  });

  describe("when this deployment holds no signing secret", () => {
    it("refuses with the same sentence rather than verifying against nothing", async () => {
      findSigningSecret.mockReturnValue(undefined);

      const response = await deliver();

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "bad_request" });
      expect(constructEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the signature does not match the bytes that were sent", () => {
    it("refuses without telling the sender which half was wrong", async () => {
      constructEvent.mockImplementation(() => {
        throw new Error("No signatures found matching the expected signature for payload");
      });

      const response = await deliver();

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "bad_request" });
      expect(handleEvent).not.toHaveBeenCalled();
    });
  });

  describe("when a signed delivery arrives", () => {
    it("verifies over the exact bytes it was sent, then dispatches the event", async () => {
      const response = await deliver();

      expect(constructEvent).toHaveBeenCalledTimes(1);
      const verified = constructEvent.mock.calls[0]?.[0];
      expect(new TextDecoder().decode(verified?.rawBody)).toBe('{"id":"evt_1"}');
      expect(verified?.signature).toBe("t=1,v1=abc");
      expect(handleEvent).toHaveBeenCalledWith(EVENT);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.json()).toEqual({ received: true });
    });
  });

  describe("when the dispatcher reports the delivery as failed", () => {
    it("answers the dispatcher's own status and sentence, so the provider retries", async () => {
      handleEvent.mockResolvedValue({
        status: "error",
        httpStatus: 500,
        message: "Subscription write failed",
      } satisfies HandleEventResult);

      const response = await deliver();

      expect(response.status).toBe(500);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ code: "internal_error" });
    });
  });
});
