import { describe, expect, it } from "vitest";
import { buildTriggerNoReplyAddress } from "../triggerNoReply";

/** The salt is a parameter now, so no environment mutation is needed. */
const NEXTAUTH_SECRET = "test-secret";

describe("buildTriggerNoReplyAddress", () => {
  describe("when called with a langwatch defaultFrom", () => {
    it("derives the domain from the From local-part and emits a hashed no-reply", () => {
      const addr = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <contact@langwatch.ai>",
        triggerId: "trigger_abc123",
        nextauthSecret: NEXTAUTH_SECRET,
      });
      expect(addr).toMatch(/^LangWatch Triggers <no-reply\+[a-f0-9]{12}@langwatch\.ai>$/);
    });
  });

  describe("when the trigger id is the same", () => {
    it("produces a stable hash so bounces route deterministically", () => {
      const a = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_same",
        nextauthSecret: NEXTAUTH_SECRET,
      });
      const b = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_same",
        nextauthSecret: NEXTAUTH_SECRET,
      });
      expect(a).toBe(b);
    });
  });

  describe("when two trigger ids differ", () => {
    it("produces distinct hashes so addresses don't collide", () => {
      const a = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_one",
        nextauthSecret: NEXTAUTH_SECRET,
      });
      const b = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <mailer@example.com>",
        triggerId: "trigger_two",
        nextauthSecret: NEXTAUTH_SECRET,
      });
      expect(a).not.toBe(b);
    });
  });

  describe("given no signing secret", () => {
    it("still produces an address, because the tag carries no authority", () => {
      const addr = buildTriggerNoReplyAddress({
        defaultFrom: "LangWatch <contact@langwatch.ai>",
        triggerId: "trigger_abc123",
        nextauthSecret: undefined,
      });
      expect(addr).toMatch(/^LangWatch Triggers <no-reply\+[a-f0-9]{12}@langwatch\.ai>$/);
    });
  });

  describe("when defaultFrom has no angle-bracket form", () => {
    it("falls back to the langwatch.ai domain rather than throw", () => {
      const addr = buildTriggerNoReplyAddress({
        defaultFrom: "bare-address@nowhere",
        triggerId: "trigger_x",
        nextauthSecret: NEXTAUTH_SECRET,
      });
      expect(addr).toMatch(/@langwatch\.ai>$/);
    });
  });
});
