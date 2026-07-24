import { describe, expect, it, vi } from "vitest";

vi.mock("../../../env.mjs", () => ({
  env: { NEXTAUTH_SECRET: "test-secret" },
}));

import { buildTriggerNoReplyAddress } from "../triggerNoReply";

describe("buildTriggerNoReplyAddress", () => {
  describe("when called with a langwatch defaultFrom", () => {
    it("derives the domain from the From local-part and emits a hashed no-reply", () => {
      const addr = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <contact@langwatch.ai>",
        triggerId: "trigger_abc123",
      });
      expect(addr).toMatch(
        /^LangWatch Triggers <no-reply\+[a-f0-9]{12}@langwatch\.ai>$/,
      );
    });
  });

  describe("when the trigger id is the same", () => {
    it("produces a stable hash so bounces route deterministically", () => {
      const a = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_same",
      });
      const b = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_same",
      });
      expect(a).toBe(b);
    });
  });

  describe("when two trigger ids differ", () => {
    it("produces distinct hashes so addresses don't collide", () => {
      const a = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_one",
      });
      const b = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_two",
      });
      expect(a).not.toBe(b);
    });
  });

  describe("when defaultFrom has no angle-bracket form", () => {
    it("falls back to the langwatch.ai domain rather than throw", () => {
      const addr = buildTriggerNoReplyAddress({
        defaultFrom: "bare-address@nowhere",
        triggerId: "trigger_x",
      });
      expect(addr).toMatch(/@langwatch\.ai>$/);
    });
  });
});
