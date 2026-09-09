/**
 * @vitest-environment node
 * `POST /api/webhooks/stripe`: its address, its door, and its four answers.
 * @see packages/enterprise/features/billing/specs/stripe-webhook.feature
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HandleEventResult } from "../../services/billing-stripe-webhook.service.ts";
import {
  billingStripeWebhookRest,
  type BillingStripeWebhookApi,
} from "../billing-stripe-webhook.rest.ts";

const declaration = billingStripeWebhookRest.router();

const EVENT = { id: "evt_1", type: "checkout.session.completed" } as unknown as Stripe.Event;

const dispatchesEvents = vi.fn<() => boolean>();
const signingSecret = vi.fn<() => string | undefined>();
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
    app: () => ({ dispatchesEvents, signingSecret, constructEvent, handleEvent }),
    credential: "public",
    onError: (error, context) => context.json({ error: String(error) }, 500),
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
  signingSecret.mockReturnValue("whsec_test");
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
      expect(route?.rawResponse?.produces).toEqual(["application/json", "text/plain"]);
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
      expect(await response.json()).toEqual({ error: "Not Found" });
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
      expect(response.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
      expect(await response.text()).toBe("Webhook Error: Missing signature or secret");
      expect(handleEvent).not.toHaveBeenCalled();
    });
  });

  describe("when this deployment holds no signing secret", () => {
    it("refuses with the same sentence rather than verifying against nothing", async () => {
      signingSecret.mockReturnValue(undefined);

      const response = await deliver();

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Webhook Error: Missing signature or secret");
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
      expect(await response.text()).toBe("Webhook Error: Invalid payload or signature");
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
      expect(response.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
      expect(await response.text()).toBe("Subscription write failed");
    });
  });
});
