import { describe, expect, it } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  eventMatches,
  isValidEventSelector,
  WEBHOOK_EVENT_TYPES,
} from "../eventRegistry";
import {
  WebhookEndpointService,
  WebhookEndpointValidationError,
} from "../webhookEndpoint.service";

describe("webhook event registry", () => {
  /** @scenario An endpoint receives only the event types it subscribed to */
  it("matches exactly the subscribed types", () => {
    const enabled = ["gateway.request.completed"];
    expect(eventMatches(enabled, "gateway.request.completed")).toBe(true);
    expect(eventMatches(enabled, "gateway.budget.breached")).toBe(false);
  });

  /** @scenario A family wildcard subscribes to every type in the family */
  it("family wildcard matches the whole family and nothing else", () => {
    const enabled = ["gateway.*"];
    for (const t of WEBHOOK_EVENT_TYPES.filter((t) => t.family === "gateway")) {
      expect(eventMatches(enabled, t.type)).toBe(true);
    }
    expect(eventMatches(enabled, "trace.settled")).toBe(false);
  });

  /** @scenario A settled event never matches a completed-only subscription */
  it("settled is its own stream: completed-only endpoints never receive it", () => {
    expect(
      eventMatches(["gateway.request.completed"], "gateway.request.settled"),
    ).toBe(false);
    expect(
      eventMatches(["gateway.request.settled"], "gateway.request.settled"),
    ).toBe(true);
    expect(eventMatches(["gateway.*"], "gateway.request.settled")).toBe(true);
    expect(eventMatches(["*"], "gateway.request.settled")).toBe(true);
  });

  /** @scenario An empty subscription receives nothing */
  it("empty subscription matches nothing", () => {
    expect(eventMatches([], "gateway.request.completed")).toBe(false);
  });

  it("the match-all selector matches every registered type", () => {
    for (const t of WEBHOOK_EVENT_TYPES) {
      expect(eventMatches(["*"], t.type)).toBe(true);
    }
  });

  it("selector validation knows exact types, family wildcards, and star", () => {
    expect(isValidEventSelector("gateway.request.completed")).toBe(true);
    expect(isValidEventSelector("gateway.*")).toBe(true);
    expect(isValidEventSelector("*")).toBe(true);
    expect(isValidEventSelector("nonsense.*")).toBe(false);
    expect(isValidEventSelector("gateway.request.imagined")).toBe(false);
  });

  /** @scenario Unknown event selectors are rejected at save time */
  it("service create rejects unknown selectors before touching storage", async () => {
    const service = new WebhookEndpointService({
      // Validation throws before any prisma call; an empty object proves it.
      prisma: {} as PrismaClient,
    });
    await expect(
      service.create({
        organizationId: "org_test",
        url: "https://example.com/hooks",
        enabledEvents: ["gateway.request.imagined"],
      }),
    ).rejects.toBeInstanceOf(WebhookEndpointValidationError);
  });
});
