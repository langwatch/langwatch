import { describe, expect, it } from "vitest";
import {
  createWebhookEndpointCommandSchema,
  eventMatches,
  isValidEventSelector,
  webhookEndpointViewSchema,
} from "../index";

describe("webhook contract", () => {
  it("validates exact, family, and global selectors", () => {
    expect(isValidEventSelector("gateway.request.completed")).toBe(true);
    expect(isValidEventSelector("gateway.*")).toBe(true);
    expect(isValidEventSelector("*")).toBe(true);
    expect(isValidEventSelector("unknown.*")).toBe(false);
    expect(eventMatches([], "gateway.request.completed")).toBe(false);
  });

  it("round-trips a portable create command", () => {
    const input = {
      organizationId: "org_1",
      url: "https://example.com/hook",
      enabledEvents: ["gateway.*"],
      maxBatchSize: 10,
    };
    expect(createWebhookEndpointCommandSchema.parse(input)).toEqual(input);
  });

  /** @scenario Endpoint secrets never appear in read values */
  it("does not expose secret fields in endpoint views", () => {
    expect("secret" in webhookEndpointViewSchema.shape).toBe(false);
    expect("secretEncrypted" in webhookEndpointViewSchema.shape).toBe(false);
    expect("sqs" in webhookEndpointViewSchema.shape).toBe(true);
  });
});
