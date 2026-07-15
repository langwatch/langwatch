import { describe, expect, it } from "vitest";

import { CanonicalizeSpanAttributesService } from "../../canonicalizeSpanAttributesService";
import { CopilotExtractor } from "../copilot";
import { createExtractorContext } from "./_testHelpers";

describe("CopilotExtractor", () => {
  describe("when the span carries copilot-specific attributes", () => {
    /** @scenario Repository and organization context are lifted onto the canonical span */
    it("lifts repository and organization onto metadata", () => {
      const ctx = createExtractorContext({
        "github.copilot.git.repository": "acme/api",
        "github.copilot.github.org": "acme",
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["metadata.copilot_repository"]).toBe("acme/api");
      expect(ctx.out["metadata.copilot_organization"]).toBe("acme");
    });

    /** @scenario Premium request consumption is lifted onto the canonical span */
    it("lifts premium-request consumption onto metadata", () => {
      const ctx = createExtractorContext({
        "github.copilot.total_premium_requests": 3,
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["metadata.copilot_premium_requests"]).toBe("3");
    });

    it("lifts copilot's own cost figure as metadata, never as langwatch cost", () => {
      // github.copilot.cost is denominated in premium-request units, not
      // dollars — dollar cost stays with the pricing-lookup pipeline.
      const ctx = createExtractorContext({ "github.copilot.cost": 1.5 });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["metadata.copilot_cost"]).toBe("1.5");
      expect(ctx.out["langwatch.cost.usd"]).toBeUndefined();
    });

    /** @scenario Raw AI-unit cost is lifted onto the canonical span */
    it("lifts the raw AI-unit count as metadata, never as langwatch cost", () => {
      // github.copilot.nano_aiu is the raw AI-unit count (nano-scale), a
      // distinct figure from github.copilot.cost — kept as metadata, never
      // a dollar field, so the pricing-lookup pipeline owns dollar cost.
      const ctx = createExtractorContext({
        "github.copilot.nano_aiu": 4459750000,
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["metadata.copilot_nano_aiu"]).toBe("4459750000");
      expect(ctx.out["langwatch.cost.usd"]).toBeUndefined();
    });

    it("lifts the hashed end-user id onto langwatch.user.id", () => {
      const ctx = createExtractorContext({
        "enduser.pseudo.id": "a1b2c3hash",
        "github.copilot.turn_id": "t1",
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["langwatch.user.id"]).toBe("a1b2c3hash");
    });

    it("recognizes provenance from the @github/copilot instrumentation scope alone", () => {
      const ctx = createExtractorContext(
        { "enduser.pseudo.id": "hash", "gen_ai.operation.name": "chat" },
        { instrumentationScope: { name: "@github/copilot", version: null } },
      );

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["langwatch.user.id"]).toBe("hash");
    });

    /** @scenario A copilot tool-execution span canonicalizes as a tool span */
    it("infers the tool span type from gen_ai.operation.name=execute_tool", () => {
      const ctx = createExtractorContext({
        "gen_ai.operation.name": "execute_tool",
        "github.copilot.tool.call.count": 1,
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["langwatch.span.type"]).toBe("tool");
    });

    /** @scenario An app tool-execution span canonicalizes as a tool span */
    it("classifies an execute_tool span carrying only the github.copilot scope (no vendor attribute) as a tool", () => {
      // The real 1.0.71 scope is "github.copilot"; an execute_tool span
      // may carry no github.copilot.* attribute, so provenance must be
      // recognized from the scope alone or the span is misclassified.
      const ctx = createExtractorContext(
        { "gen_ai.operation.name": "execute_tool" },
        { instrumentationScope: { name: "github.copilot", version: "1.0.71-0" } },
      );

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["langwatch.span.type"]).toBe("tool");
    });

    it("infers the agent span type from invoke_agent", () => {
      const ctx = createExtractorContext({
        "gen_ai.operation.name": "invoke_agent",
        "github.copilot.turn_id": "t1",
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["langwatch.span.type"]).toBe("agent");
    });

    it("respects a span type set by an earlier extractor", () => {
      // Preset ("llm") differs from what the operation would infer
      // ("tool") so a broken always-overwrite guard flips the result.
      const ctx = createExtractorContext({
        "gen_ai.operation.name": "execute_tool",
        "github.copilot.turn_id": "t1",
      });
      ctx.out["langwatch.span.type"] = "llm";

      new CopilotExtractor().apply(ctx);

      expect(ctx.out["langwatch.span.type"]).toBe("llm");
    });
  });

  describe("when the span has no copilot provenance", () => {
    /** @scenario A span without gen_ai attributes is left untouched by the copilot extractor */
    it("lifts nothing from a foreign span", () => {
      const ctx = createExtractorContext({
        "gen_ai.operation.name": "invoke_agent",
        "some.other.attr": "x",
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out).toEqual({});
    });

    it("never consumes a foreign tenant's enduser.pseudo.id (standard semconv, not a copilot marker)", () => {
      const ctx = createExtractorContext({
        "enduser.pseudo.id": "someone-elses-user-hash",
        "gen_ai.operation.name": "chat",
      });

      new CopilotExtractor().apply(ctx);

      expect(ctx.out).toEqual({});
      expect(ctx.bag.attrs.has("enduser.pseudo.id")).toBe(true);
    });
  });

  describe("when run through the full canonicalisation chain", () => {
    // Uses the real CanonicalizeSpanAttributesService so the assertion
    // covers registration order AND the service's remaining() merge —
    // GenAI leaves already-canonical gen_ai.* keys in the bag, and the
    // service merges them into the result at the end.
    const canonicalize = (attrs: Record<string, unknown>) =>
      new CanonicalizeSpanAttributesService().canonicalize(
        attrs as Parameters<
          CanonicalizeSpanAttributesService["canonicalize"]
        >[0],
        [],
        {
          name: "chat gpt-5",
          kind: 0,
          instrumentationScope: { name: "@github/copilot" },
          statusMessage: null,
          statusCode: null,
          parentSpanId: null,
        } as unknown as Parameters<
          CanonicalizeSpanAttributesService["canonicalize"]
        >[2],
      );

    /** @scenario A copilot chat span yields model and token usage on the canonical trace */
    it("GenAI lifts the standard core and Copilot adds only the extras", () => {
      const result = canonicalize({
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "gpt-5",
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.usage.output_tokens": 350,
        "github.copilot.total_premium_requests": 1,
        "enduser.pseudo.id": "hash",
      });

      // Standard core — GenAI's work, zero copilot-specific code.
      // appliedRules pins the delegation: without GenAIExtractor in the
      // chain these attrs would still merge via remaining(), so the
      // value assertions alone would be unfalsifiable.
      expect(
        result.appliedRules.some((r) => r.startsWith("genai:")),
      ).toBe(true);
      expect(result.attributes["gen_ai.request.model"]).toBe("gpt-5");
      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(1200);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(350);
      // Extras — Copilot's work.
      expect(
        result.appliedRules.some((r) => r.startsWith("copilot:")),
      ).toBe(true);
      expect(result.attributes["metadata.copilot_premium_requests"]).toBe("1");
      expect(result.attributes["langwatch.user.id"]).toBe("hash");
    });

    /** @scenario Captured content payloads are lifted as span input and output */
    it("content on gen_ai.input/output.messages survives to the canonical attributes", () => {
      const result = canonicalize({
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "fix the bug" },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", content: "done" },
        ]),
        "github.copilot.turn_id": "t1",
      });

      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
      expect(result.attributes["gen_ai.output.messages"]).toBeDefined();
    });
  });

  describe("when a VS Code copilot-chat span runs through the chain", () => {
    // VS Code Copilot Chat emits under the `copilot-chat` instrumentation
    // scope (not `github.copilot`), so the shared GenAI core canonicalizes
    // it and the copilot extractor stays inert — ADR-039 §Extension #2's
    // "no VS-Code-specific extractor code in v1".
    const canonicalizeVscode = (attrs: Record<string, unknown>) =>
      new CanonicalizeSpanAttributesService().canonicalize(
        attrs as Parameters<
          CanonicalizeSpanAttributesService["canonicalize"]
        >[0],
        [],
        {
          name: "chat",
          kind: 0,
          instrumentationScope: { name: "copilot-chat" },
          statusMessage: null,
          statusCode: null,
          parentSpanId: null,
        } as unknown as Parameters<
          CanonicalizeSpanAttributesService["canonicalize"]
        >[2],
      );

    /** @scenario A copilot-chat span yields model and token usage on the canonical trace */
    it("GenAI lifts model and token usage from a copilot-chat span with no copilot-specific code", () => {
      const result = canonicalizeVscode({
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "oswe-vscode-prime",
        "gen_ai.usage.input_tokens": 618820,
        "gen_ai.usage.output_tokens": 11348,
        // VS Code's own AI-unit attr (not github.copilot.nano_aiu) — v1
        // ignores it (tokens-only); asserted below via the absence of
        // copilot: rules.
        copilot_usage_nano_aiu: 230235000,
      });

      expect(
        result.appliedRules.some((r) => r.startsWith("genai:")),
      ).toBe(true);
      expect(result.attributes["gen_ai.request.model"]).toBe(
        "oswe-vscode-prime",
      );
      expect(result.attributes["gen_ai.usage.input_tokens"]).toBe(618820);
      expect(result.attributes["gen_ai.usage.output_tokens"]).toBe(11348);
      // the copilot extractor gates on the github.copilot scope, so it never
      // fires for copilot-chat — no VS-Code-specific extractor code.
      expect(
        result.appliedRules.some((r) => r.startsWith("copilot:")),
      ).toBe(false);
    });

    /** @scenario Captured prompt content is lifted as span input */
    it("lifts captured prompt content as span input", () => {
      const result = canonicalizeVscode({
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "langwatch vscode probe" },
        ]),
      });

      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
    });
  });
});
