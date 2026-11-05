import { HOOKS_PREVIOUS_SECRET_TTL_MS } from "@langwatch/agent-contract";
import { WEBHOOK_PREVIOUS_SECRET_TTL_MS } from "@langwatch/webhook-contract";
import { describe, expect, it } from "vitest";

describe("HOOKS_PREVIOUS_SECRET_TTL_MS", () => {
  it("equals the webhook previous-secret window the server enforces", () => {
    expect(HOOKS_PREVIOUS_SECRET_TTL_MS).toBe(WEBHOOK_PREVIOUS_SECRET_TTL_MS);
  });

  it("is 24 hours, the window the form text states", () => {
    expect(HOOKS_PREVIOUS_SECRET_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
