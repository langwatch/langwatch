import { describe, expect, it } from "vitest";

import { redactV2Content } from "../tracesV2";

describe("redactV2Content", () => {
  describe("given the viewer cannot see captured input", () => {
    it("nulls the input and keeps the output", () => {
      const out = redactV2Content(
        { input: "hello", output: "world" },
        { canSeeCapturedInput: false, canSeeCapturedOutput: true },
      );

      expect(out.input).toBeNull();
      expect(out.output).toBe("world");
    });
  });

  describe("given hidden custom attribute rules for the viewer", () => {
    const protections = {
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
      hiddenAttributes: [{ pattern: "app.billing.*", visibleTo: "Admins" }],
    };

    /** @scenario A restricted custom attribute is hidden from outside the audience */
    it("redacts matching span params, flat header attributes, and event attributes", () => {
      const out = redactV2Content(
        {
          input: "hello",
          output: "world",
          attributes: { "app.billing.card_token": "tok", "service.name": "x" },
          params: { app: { billing: { card_token: "tok" } }, model: "gpt-5" },
          events: [
            {
              name: "e1",
              attributes: { "app.billing.plan": "pro", keep: "yes" },
            },
          ],
        },
        protections,
      );

      expect(out.attributes?.["app.billing.card_token"]).toBe(
        "[REDACTED] (visible to Admins)",
      );
      expect(out.attributes?.["service.name"]).toBe("x");
      expect(
        (out.params as { app: { billing: { card_token: string } } }).app.billing
          .card_token,
      ).toBe("[REDACTED] (visible to Admins)");
      expect((out.params as { model: string }).model).toBe("gpt-5");
      const event = (
        out as unknown as {
          events: Array<{ attributes: Record<string, unknown> }>;
        }
      ).events[0]!;
      expect(event.attributes["app.billing.plan"]).toBe(
        "[REDACTED] (visible to Admins)",
      );
      expect(event.attributes.keep).toBe("yes");
    });

    it("leaves the privacy drop markers untouched", () => {
      const out = redactV2Content(
        {
          input: null,
          output: null,
          attributes: {
            "langwatch.privacy.dropped": "input",
            "langwatch.privacy.dropped_attributes": "app.internal.session",
          },
        },
        protections,
      );

      expect(out.attributes?.["langwatch.privacy.dropped"]).toBe("input");
      expect(out.attributes?.["langwatch.privacy.dropped_attributes"]).toBe(
        "app.internal.session",
      );
    });
  });

  describe("given no hidden attributes", () => {
    it("does not touch params or attributes", () => {
      const params = { a: 1 };
      const out = redactV2Content(
        { input: "x", output: "y", params },
        { canSeeCapturedInput: true, canSeeCapturedOutput: true },
      );

      expect(out.params).toBe(params);
    });
  });
});
