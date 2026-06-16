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
          params: {
            app: { billing: { card_token: "tok" } },
            model: "gpt-5-mini",
          },
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
      expect((out.params as { model: string }).model).toBe("gpt-5-mini");
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

  describe("given a restrict rule hides content from the viewer", () => {
    it("flags the field redacted and carries the audience label", () => {
      const out = redactV2Content(
        { input: "secret prompt", output: "secret answer" },
        {
          canSeeCapturedInput: false,
          canSeeCapturedOutput: false,
          capturedInputVisibleTo: "Admins, Security group",
          capturedOutputVisibleTo: "Admins, Security group",
        },
      );

      expect(out.input).toBeNull();
      expect(out.inputRedacted).toBe(true);
      expect(out.inputVisibleTo).toBe("Admins, Security group");
      expect(out.outputRedacted).toBe(true);
      expect(out.outputVisibleTo).toBe("Admins, Security group");
    });

    it("does not flag a genuinely empty field as redacted", () => {
      const out = redactV2Content(
        { input: null, output: "world" },
        { canSeeCapturedInput: false, canSeeCapturedOutput: true },
      );

      expect(out.inputRedacted).toBe(false);
      expect(out.inputVisibleTo).toBeNull();
      expect(out.outputRedacted).toBe(false);
    });

    it("does not flag content the viewer is allowed to see", () => {
      const out = redactV2Content(
        { input: "hello" },
        { canSeeCapturedInput: true, canSeeCapturedOutput: true },
      );

      expect(out.input).toBe("hello");
      expect(out.inputRedacted).toBe(false);
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
