import { describe, expect, it } from "vitest";
import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import { deriveSessionBanner } from "../sessionBanner";

function modelSpan(model: string, atMs: number): SpanDetail {
  return {
    spanId: `llm-${atMs}`,
    name: "claude_code.llm_request",
    startTimeMs: atMs,
    params: { "gen_ai.request.model": model },
  } as unknown as SpanDetail;
}

describe("deriveSessionBanner", () => {
  describe("given resource attributes and model-call spans", () => {
    it("reads the version and repo off the resource, and the model off the last call", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: {
          "service.version": "2.1.207",
          "project.repo": "langwatch/langwatch",
        },
        spans: [
          modelSpan("claude-opus-4-8", 1_000),
          modelSpan("claude-sonnet-5", 2_000),
        ],
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
        spans: [
          { name: "some.custom.span", params: {} } as unknown as SpanDetail,
        ],
      });
      expect(banner.agent).toBe("unknown");
    });
  });

  describe("given the model rides another agent's call span", () => {
    it("reads gemini's llm_call and copilot's chat span all the same", () => {
      const banner = deriveSessionBanner({
        resourceAttributes: { "service.name": "gemini-cli" },
        spans: [
          {
            spanId: "s1",
            name: "llm_call",
            startTimeMs: 1,
            params: { "gen_ai.request.model": "gemini-3.5-flash" },
          } as unknown as SpanDetail,
        ],
      });
      expect(banner.model).toBe("gemini-3.5-flash");

      const copilot = deriveSessionBanner({
        resourceAttributes: { "service.name": "copilot-cli" },
        spans: [
          {
            spanId: "s2",
            name: "chat gpt-5-mini",
            startTimeMs: 1,
            params: { "gen_ai.request.model": "gpt-5-mini" },
          } as unknown as SpanDetail,
        ],
      });
      expect(copilot.model).toBe("gpt-5-mini");
    });
  });
});
