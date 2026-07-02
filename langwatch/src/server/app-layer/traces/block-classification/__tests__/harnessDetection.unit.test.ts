import { describe, expect, it } from "vitest";
import { detectCodingAgentHarness } from "../harnessDetection";

describe("detectCodingAgentHarness", () => {
  describe("given a Claude Code native scope", () => {
    it("detects the claude harness", () => {
      expect(
        detectCodingAgentHarness({
          instrumentationScopeName: "com.anthropic.claude_code.events",
          spanAttributes: {},
        }),
      ).toBe("claude");
    });
  });

  describe("given a span stamped gen_ai.system=claude_code", () => {
    it("detects the claude harness without a claude scope", () => {
      expect(
        detectCodingAgentHarness({
          instrumentationScopeName: "some.other.scope",
          spanAttributes: { "gen_ai.system": "claude_code" },
        }),
      ).toBe("claude");
    });
  });

  describe("given the Codex Rust CLI scope", () => {
    it("detects the codex harness", () => {
      expect(
        detectCodingAgentHarness({
          instrumentationScopeName: "codex_cli_rs",
          spanAttributes: {},
        }),
      ).toBe("codex");
    });
  });

  describe("given a span from a non-coding-agent source", () => {
    it("returns null", () => {
      expect(
        detectCodingAgentHarness({
          instrumentationScopeName: "openinference.langchain",
          spanAttributes: { "gen_ai.system": "openai" },
        }),
      ).toBeNull();
    });

    it("returns null when the scope name is missing", () => {
      expect(
        detectCodingAgentHarness({
          instrumentationScopeName: null,
          spanAttributes: {},
        }),
      ).toBeNull();
    });
  });
});
