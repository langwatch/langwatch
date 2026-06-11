import { describe, expect, it } from "vitest";

import { redactHiddenAttributes } from "../redactAttributes";

const hidden = [
  { pattern: "app.billing.*", visibleTo: "Admins" },
  { pattern: "app.session_token", visibleTo: "no one" },
];

describe("redactHiddenAttributes", () => {
  describe("given a flat dotted-key record", () => {
    /** @scenario A restricted custom attribute is hidden from outside the audience */
    it("replaces matched values with a placeholder naming the audience and keeps the rest", () => {
      const result = redactHiddenAttributes(
        {
          "app.billing.card_token": "tok_123",
          "app.session_token": "sess_456",
          "gen_ai.request.model": "gpt-5-mini",
        },
        hidden,
      );

      expect(result["app.billing.card_token"]).toBe(
        "[REDACTED] (visible to Admins)",
      );
      expect(result["app.session_token"]).toBe(
        "[REDACTED] (visible to no one)",
      );
      expect(result["gen_ai.request.model"]).toBe("gpt-5-mini");
    });
  });

  describe("given a nested attribute object", () => {
    it("matches the dotted path of nested leaves", () => {
      const result = redactHiddenAttributes(
        {
          app: {
            billing: { card_token: "tok_123", plan: "pro" },
            public: { label: "ok" },
          },
        },
        hidden,
      ) as Record<string, Record<string, Record<string, unknown>>>;

      expect(result.app!.billing!.card_token).toBe(
        "[REDACTED] (visible to Admins)",
      );
      expect(result.app!.billing!.plan).toBe("[REDACTED] (visible to Admins)");
      expect(result.app!.public!.label).toBe("ok");
    });

    it("replaces a matched array whole instead of entering it", () => {
      const result = redactHiddenAttributes(
        { app: { billing: { items: [1, 2, 3] } }, other: [4, 5] },
        hidden,
      ) as Record<string, unknown>;

      expect((result.app as any).billing.items).toBe(
        "[REDACTED] (visible to Admins)",
      );
      expect(result.other).toEqual([4, 5]);
    });
  });

  describe("given the first matching pattern decides the label", () => {
    it("uses the first match when several patterns hit the same path", () => {
      const result = redactHiddenAttributes({ "app.billing.card_token": "x" }, [
        { pattern: "app.*", visibleTo: "Security" },
        { pattern: "app.billing.*", visibleTo: "Admins" },
      ]);

      expect(result["app.billing.card_token"]).toBe(
        "[REDACTED] (visible to Security)",
      );
    });
  });

  describe("given nothing matches or nothing is hidden", () => {
    it("returns the same reference untouched", () => {
      const value = { "gen_ai.request.model": "gpt-5-mini" };

      expect(redactHiddenAttributes(value, hidden)).toBe(value);
      expect(redactHiddenAttributes(value, [])).toBe(value);
      expect(redactHiddenAttributes(value, undefined)).toBe(value);
      expect(redactHiddenAttributes(null, hidden)).toBe(null);
    });
  });
});
