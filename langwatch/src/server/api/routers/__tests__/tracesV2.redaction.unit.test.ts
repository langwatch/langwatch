import { describe, expect, it } from "vitest";
import type { ContentCategory } from "~/server/data-privacy/dataPrivacy.types";
import type { CategoryVisibility } from "~/server/elasticsearch/protections";
import { buildContentPrivacy, redactV2Content } from "../tracesV2";

const visible: CategoryVisibility = { canSee: true, restrictVisibleTo: null };

/** A full per-category visibility map, all visible unless overridden. */
function cats(
  overrides: Partial<Record<ContentCategory, CategoryVisibility>> = {},
): Record<ContentCategory, CategoryVisibility> {
  return {
    input: { ...visible },
    output: { ...visible },
    system: { ...visible },
    tools: { ...visible },
    ...overrides,
  };
}

const restricted = (visibleTo: string | null): CategoryVisibility => ({
  canSee: false,
  restrictVisibleTo: visibleTo,
});

const restrictedVisible = (visibleTo: string): CategoryVisibility => ({
  canSee: true,
  restrictVisibleTo: visibleTo,
});

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

  describe("given system instructions are restricted from the viewer", () => {
    const conversation = JSON.stringify({
      type: "chat_messages",
      value: [
        { role: "system", content: "secret instructions" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });

    it("strips the system turn from the visible conversation", () => {
      const out = redactV2Content(
        { input: conversation },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ system: restricted("Admins") }),
        },
      );

      const parsed = JSON.parse(out.input!) as {
        value: Array<{ role: string }>;
      };
      expect(parsed.value.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(out.input).not.toContain("secret instructions");
    });

    it("replaces the standalone system-instructions attribute with the audience placeholder", () => {
      const out = redactV2Content(
        {
          input: null,
          params: {
            gen_ai: { system_instructions: "secret" },
            model: "gpt-5-mini",
          },
        },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ system: restricted("Admins") }),
        },
      );

      const params = out.params as {
        gen_ai: { system_instructions: string };
        model: string;
      };
      expect(params.gen_ai.system_instructions).toBe(
        "[REDACTED] (visible to Admins)",
      );
      expect(params.model).toBe("gpt-5-mini");
    });
  });

  describe("given tool calls are restricted from the viewer", () => {
    /** @scenario Tool calls restricted to a group are visible to that group and hidden from others */
    it("strips tool turns and assistant tool_calls, keeping user and assistant text", () => {
      const conversation = JSON.stringify([
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "calling",
          tool_calls: [{ id: "1", function: { name: "lookup" } }],
        },
        { role: "tool", content: "tool result" },
      ]);

      const out = redactV2Content(
        { input: conversation },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ tools: restricted("Security group") }),
        },
      );

      const parsed = JSON.parse(out.input!) as Array<{
        role: string;
        tool_calls?: unknown;
      }>;
      expect(parsed.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(parsed[1]!.tool_calls).toBeUndefined();
      expect(out.input).not.toContain("tool result");
    });

    it("strips the hidden turns from the raw chat-array attributes too (nested params and flat attributes)", () => {
      const messages = [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "1", function: { name: "lookup" } }],
        },
        { role: "tool", content: "SECRET tool result" },
      ];
      const out = redactV2Content(
        {
          input: null,
          // Nested params (the span mapper unflattens dotted keys).
          params: { gen_ai: { input: { messages } } },
          // Flat attributes carry the conversation as a JSON string.
          attributes: { "gen_ai.input.messages": JSON.stringify(messages) },
        },
        {
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          contentCategories: cats({ tools: restricted("Admins") }),
        },
      );

      const paramsMessages = (
        out.params as {
          gen_ai: { input: { messages: Array<{ role: string }> } };
        }
      ).gen_ai.input.messages;
      expect(paramsMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(JSON.stringify(out.params)).not.toContain("SECRET tool result");
      expect(JSON.stringify(out.params)).not.toContain("tool_calls");
      expect(out.attributes?.["gen_ai.input.messages"]).not.toContain(
        "SECRET tool result",
      );
    });
  });
});

describe("buildContentPrivacy", () => {
  /** @scenario Each dropped category is marked where its content would appear */
  it("marks a dropped category as dropped, distinct from a restriction", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats() },
      new Set(["system"]),
    );
    expect(privacy.system).toEqual({ state: "dropped", visibleTo: null });
  });

  it("marks a restricted-hidden category and names who can see it", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats({ tools: restricted("Admins") }) },
      new Set(),
    );
    expect(privacy.tools).toEqual({ state: "restricted", visibleTo: "Admins" });
  });

  it("marks restricted-but-visible content so an in-audience viewer is told", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats({ input: restrictedVisible("Admins") }) },
      new Set(),
    );
    expect(privacy.input).toEqual({ state: "visible", visibleTo: "Admins" });
  });

  it("leaves plainly captured content unmarked", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats() },
      new Set(),
    );
    expect(privacy.output).toEqual({ state: "visible", visibleTo: null });
  });

  it("lets a drop win over a restriction on the same category", () => {
    const privacy = buildContentPrivacy(
      { contentCategories: cats({ system: restricted("Admins") }) },
      new Set(["system"]),
    );
    expect(privacy.system.state).toBe("dropped");
  });
});
