import type { SpanDetail } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { deriveSessionBanner } from "../terminal-session-banner.ts";

function span(over: Partial<SpanDetail>): SpanDetail {
  return {
    spanId: "s1",
    parentSpanId: null,
    name: "claude_code.llm_request",
    type: "llm",
    startTimeMs: 1,
    endTimeMs: 1,
    durationMs: 0,
    status: "ok",
    params: {},
    events: [],
    ...over,
  };
}

function modelSpan(model: string, atMs: number): SpanDetail {
  return span({
    spanId: `llm-${atMs}`,
    name: "claude_code.llm_request",
    startTimeMs: atMs,
    params: { "gen_ai.request.model": model },
  });
}

describe("deriveSessionBanner", () => {
  describe("given resource attributes and model-call spans", () => {
    it("reads the version and repo off the resource, and the model off the last call", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: {
          "service.version": "2.1.207",
          "project.repo": "langwatch/langwatch",
        },
        spans: [modelSpan("claude-opus-4-8", 1_000), modelSpan("claude-sonnet-5", 2_000)],
      });

      expect(banner).toEqual({
        agent: "claude_code",
        version: "2.1.207",
        model: "claude-sonnet-5",
        repo: "langwatch/langwatch",
      });
    });
  });

  describe("given no model-call spans", () => {
    it("reports the model as unknown rather than guessing", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.version": "2.1.207" },
        spans: [],
      });

      expect(banner.model).toBeNull();
    });
  });

  describe("given each agent's service name", () => {
    it.each([
      ["claude-code", "claude_code"],
      ["opencode", "opencode"],
      ["codex", "codex"],
      ["gemini-cli", "gemini_cli"],
      ["copilot-cli", "copilot"],
    ] as const)("identifies %s as %s", (serviceName, agent) => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.name": serviceName },
        spans: [],
      });
      expect(banner.agent).toBe(agent);
    });
  });

  describe("given no service name and unrecognized spans", () => {
    it("stays unknown instead of wearing another agent's badge", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: {},
        spans: [span({ name: "some.custom.span", params: {} })],
      });
      expect(banner.agent).toBe("unknown");
    });
  });

  describe("given no service name and a copilot-named call span", () => {
    it("falls back to copilot off the 'chat <model>' span name", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: {},
        spans: [
          span({
            spanId: "s1",
            name: "chat gpt-5-mini",
            startTimeMs: 1,
            params: {},
          }),
        ],
      });
      expect(banner.agent).toBe("copilot");
    });
  });

  describe("given a pi session, named only by its span namespace", () => {
    /** @scenario "The banner of a pi session names the model pi called" */
    it("names pi and the model its last pi.ai.request called", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.name": "pi", "service.version": "0.84.2" },
        spans: [
          span({ spanId: "run", name: "pi.harness.run", type: "agent", startTimeMs: 1 }),
          span({ spanId: "turn", parentSpanId: "run", name: "pi.harness.turn", startTimeMs: 2 }),
          span({
            spanId: "call",
            parentSpanId: "turn",
            name: "pi.ai.request",
            startTimeMs: 3,
            params: { gen_ai: { request: { model: "claude-sonnet-5" } } },
          }),
          span({ spanId: "tool", parentSpanId: "turn", name: "pi.harness.tool", startTimeMs: 4 }),
        ],
      });

      expect(banner).toEqual({
        agent: "pi",
        version: "0.84.2",
        model: "claude-sonnet-5",
        repo: null,
      });
    });

    it("does not read pi into another agent's service name", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.name": "acme-api" },
        spans: [span({ name: "some.custom.span" })],
      });
      expect(banner.agent).toBe("unknown");
    });
  });

  describe("given real-shaped NESTED span params", () => {
    it("still reads the model: the span mapper unflattens dotted keys", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.name": "claude-code" },
        spans: [
          span({
            spanId: "s1",
            name: "claude_code.llm_request",
            startTimeMs: 1,
            params: { gen_ai: { request: { model: "claude-sonnet-5" } } },
          }),
        ],
      });
      expect(banner.model).toBe("claude-sonnet-5");
    });
  });

  describe("given the model rides another agent's call span", () => {
    it("reads gemini's llm_call and copilot's chat span all the same", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.name": "gemini-cli" },
        spans: [
          span({
            spanId: "s1",
            name: "llm_call",
            startTimeMs: 1,
            params: { "gen_ai.request.model": "gemini-3.5-flash" },
          }),
        ],
      });
      expect(banner.model).toBe("gemini-3.5-flash");

      const copilot = deriveSessionBanner({
        resourceAttributes: { "service.name": "copilot-cli" },
        spans: [
          span({
            spanId: "s2",
            name: "chat gpt-5-mini",
            startTimeMs: 1,
            params: { "gen_ai.request.model": "gpt-5-mini" },
          }),
        ],
      });
      expect(copilot.model).toBe("gpt-5-mini");
    });
  });

  describe("given a Grok session, which sends logs and no spans", () => {
    // Resource and attributes as grok 1.0.70 sent them on a captured session.
    const GROK_RESOURCE = {
      "service.name": "grok-cli",
      "service.version": "1.0.70 (f50904eaee6c)",
      "client.version": "1.0.70",
    };
    const grokLog = (timeUnixMs: number, attributes: Record<string, string>) => ({
      timeUnixMs,
      attributes,
      resourceAttributes: GROK_RESOURCE,
    });

    /** @scenario The terminal banner names Grok and its version */
    it("names Grok from its log records' resource, with the version Grok itself prints", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: {},
        spans: [],
        logs: [grokLog(1_000, { "event.name": "grok_code.assistant_response" })],
      });

      expect(banner).toEqual({ agent: "grok", version: "1.0.70", model: null, repo: null });
    });

    /** @scenario "The terminal banner shows the model Grok's records name" */
    it("reads the model off the last Grok record that names one", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: {},
        spans: [],
        logs: [
          grokLog(3_000, { "event.name": "grok_code.api_request", model: "grok-4.7-fast" }),
          grokLog(1_000, { "event.name": "grok_code.user_prompt", model: "grok-4.7" }),
          grokLog(4_000, { "event.name": "grok_code.assistant_response" }),
        ],
      });

      expect(banner.model).toBe("grok-4.7-fast");
    });

    it("prefers the span resource when the trace has one", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.name": "claude-code", "service.version": "2.1.207" },
        spans: [],
        logs: [grokLog(1_000, {})],
      });

      expect(banner.agent).toBe("claude_code");
      expect(banner.version).toBe("2.1.207");
    });
  });
});
