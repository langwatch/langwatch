import { describe, expect, it } from "vitest";
import {
  claudeCodeLogKind,
  isClaudeCodeConvertibleLog,
  isClaudeCodeToolLog,
} from "../claude-code-log-events";

const SCOPE = "com.anthropic.claude_code.events";

describe("isClaudeCodeConvertibleLog", () => {
  it("matches only the 3 model-call events under the claude_code scope", () => {
    expect(isClaudeCodeConvertibleLog(SCOPE, "api_request")).toBe(true);
    expect(isClaudeCodeConvertibleLog(SCOPE, "api_request_body")).toBe(true);
    expect(isClaudeCodeConvertibleLog(SCOPE, "api_response_body")).toBe(true);
    expect(isClaudeCodeConvertibleLog(SCOPE, "user_prompt")).toBe(false);
    expect(isClaudeCodeConvertibleLog(SCOPE, "hook_registered")).toBe(false);
    expect(isClaudeCodeConvertibleLog(SCOPE, undefined)).toBe(false);
    expect(
      isClaudeCodeConvertibleLog("com.openai.codex.events", "api_request"),
    ).toBe(false);
  });
});

describe("isClaudeCodeToolLog", () => {
  it("matches only tool_decision / tool_result under the claude_code scope", () => {
    expect(isClaudeCodeToolLog(SCOPE, "tool_decision")).toBe(true);
    expect(isClaudeCodeToolLog(SCOPE, "tool_result")).toBe(true);
    expect(isClaudeCodeToolLog(SCOPE, "api_request")).toBe(false);
    expect(isClaudeCodeToolLog(SCOPE, "user_prompt")).toBe(false);
    expect(isClaudeCodeToolLog(SCOPE, undefined)).toBe(false);
    expect(isClaudeCodeToolLog("com.openai.codex.events", "tool_result")).toBe(
      false,
    );
  });
});

describe("claudeCodeLogKind", () => {
  it("maps model, tool, and turn events to their kind and everything else to null", () => {
    expect(claudeCodeLogKind(SCOPE, "api_request")).toBe("model");
    expect(claudeCodeLogKind(SCOPE, "api_request_body")).toBe("model");
    expect(claudeCodeLogKind(SCOPE, "api_response_body")).toBe("model");
    expect(claudeCodeLogKind(SCOPE, "tool_decision")).toBe("tool");
    expect(claudeCodeLogKind(SCOPE, "tool_result")).toBe("tool");
    expect(claudeCodeLogKind(SCOPE, "user_prompt")).toBe("turn");
    expect(claudeCodeLogKind(SCOPE, "hook_registered")).toBeNull();
    expect(claudeCodeLogKind(SCOPE, undefined)).toBeNull();
    expect(claudeCodeLogKind("com.openai.codex.events", "api_request")).toBeNull();
  });
});
