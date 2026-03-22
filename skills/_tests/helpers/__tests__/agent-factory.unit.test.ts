import { describe, it, expect, vi, afterEach } from "vitest";
import { getRunner, createAgent } from "../agent-factory";

describe("getRunner()", () => {
  afterEach(() => {
    delete process.env.AGENT_UNDER_TEST;
  });

  describe("when AGENT_UNDER_TEST is not set", () => {
    it("defaults to claude-code", () => {
      delete process.env.AGENT_UNDER_TEST;
      const runner = getRunner();
      expect(runner.name).toBe("claude-code");
    });
  });

  describe("when AGENT_UNDER_TEST is claude-code", () => {
    it("returns the Claude Code runner", () => {
      process.env.AGENT_UNDER_TEST = "claude-code";
      const runner = getRunner();
      expect(runner.name).toBe("claude-code");
      expect(runner.capabilities.supportsMcp).toBe(true);
      expect(runner.capabilities.skillsDirectory).toBe(".skills");
      expect(runner.capabilities.configFile).toBe("CLAUDE.md");
    });
  });

  describe("when AGENT_UNDER_TEST is codex", () => {
    it("returns the Codex runner", () => {
      process.env.AGENT_UNDER_TEST = "codex";
      const runner = getRunner();
      expect(runner.name).toBe("codex");
      expect(runner.capabilities.supportsMcp).toBe(false);
      expect(runner.capabilities.skillsDirectory).toBe(".agents/skills");
      expect(runner.capabilities.configFile).toBeUndefined();
    });
  });

  describe("when AGENT_UNDER_TEST is cursor", () => {
    it("returns the Cursor runner", () => {
      process.env.AGENT_UNDER_TEST = "cursor";
      const runner = getRunner();
      expect(runner.name).toBe("cursor");
      expect(runner.capabilities.supportsMcp).toBe(false);
      expect(runner.capabilities.skillsDirectory).toBe(".cursor/skills");
    });
  });

  describe("when AGENT_UNDER_TEST is unknown", () => {
    it("throws an error identifying the unknown agent", () => {
      process.env.AGENT_UNDER_TEST = "unknown-assistant";
      expect(() => getRunner()).toThrow(
        'Unknown agent "unknown-assistant"'
      );
    });
  });
});

describe("createAgent()", () => {
  afterEach(() => {
    delete process.env.AGENT_UNDER_TEST;
  });

  describe("when called with defaults", () => {
    it("returns an adapter with a call method", () => {
      delete process.env.AGENT_UNDER_TEST;
      const adapter = createAgent({ workingDirectory: "/tmp/test" });
      expect(adapter).toBeDefined();
      expect(typeof adapter.call).toBe("function");
    });
  });
});

describe("backward compatibility", () => {
  it("re-exports createClaudeCodeAgent from claude-code-adapter", async () => {
    const { createClaudeCodeAgent } = await import("../claude-code-adapter");
    expect(typeof createClaudeCodeAgent).toBe("function");
  });

  it("re-exports toolCallFix from claude-code-adapter", async () => {
    const { toolCallFix } = await import("../claude-code-adapter");
    expect(typeof toolCallFix).toBe("function");
  });

  it("re-exports assertSkillWasRead from claude-code-adapter", async () => {
    const { assertSkillWasRead } = await import("../claude-code-adapter");
    expect(typeof assertSkillWasRead).toBe("function");
  });
});
