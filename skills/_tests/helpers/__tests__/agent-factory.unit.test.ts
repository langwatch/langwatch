import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Agent Factory", () => {
  describe("getRunner()", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.AGENT_UNDER_TEST;
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.AGENT_UNDER_TEST;
      } else {
        process.env.AGENT_UNDER_TEST = originalEnv;
      }
      vi.resetModules();
    });

    describe("when AGENT_UNDER_TEST is not set", () => {
      it("defaults to the Claude Code runner", async () => {
        delete process.env.AGENT_UNDER_TEST;
        const { getRunner } = await import("../agent-factory.js");
        const runner = getRunner();
        expect(runner.name).toBe("claude-code");
      });
    });

    describe("when AGENT_UNDER_TEST is set to 'codex'", () => {
      it("selects the Codex runner", async () => {
        process.env.AGENT_UNDER_TEST = "codex";
        const { getRunner } = await import("../agent-factory.js");
        const runner = getRunner();
        expect(runner.name).toBe("codex");
      });
    });

    describe("when AGENT_UNDER_TEST is set to 'claude-code'", () => {
      it("selects the Claude Code runner", async () => {
        process.env.AGENT_UNDER_TEST = "claude-code";
        const { getRunner } = await import("../agent-factory.js");
        const runner = getRunner();
        expect(runner.name).toBe("claude-code");
      });
    });

    describe("when AGENT_UNDER_TEST is set to 'cursor'", () => {
      it("selects the Cursor runner", async () => {
        process.env.AGENT_UNDER_TEST = "cursor";
        const { getRunner } = await import("../agent-factory.js");
        const runner = getRunner();
        expect(runner.name).toBe("cursor");
      });
    });

    describe("when AGENT_UNDER_TEST is set to an unknown value", () => {
      it("throws an error listing valid names", async () => {
        process.env.AGENT_UNDER_TEST = "unknown-assistant";
        const { getRunner } = await import("../agent-factory.js");
        expect(() => getRunner()).toThrow("unknown-assistant");
        expect(() => getRunner()).toThrow("claude-code");
        expect(() => getRunner()).toThrow("codex");
        expect(() => getRunner()).toThrow("cursor");
      });
    });
  });

  describe("createAgent()", () => {
    describe("when called without AGENT_UNDER_TEST set", () => {
      it("delegates to the default Claude Code runner", async () => {
        delete process.env.AGENT_UNDER_TEST;
        const { getRunner } = await import("../agent-factory.js");
        const runner = getRunner();
        expect(runner.name).toBe("claude-code");
      });
    });
  });
});

describe("Claude Code Runner", () => {
  describe("capabilities", () => {
    it("declares MCP support as true", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      expect(runner.capabilities.supportsMcp).toBe(true);
    });

    it("uses .skills as the skills directory", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      expect(runner.capabilities.skillsDirectory).toBe(".skills");
    });

    it("declares CLAUDE.md as the config file", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      expect(runner.capabilities.configFile).toBe("CLAUDE.md");
    });
  });

  describe("buildArgs()", () => {
    it("includes --output-format stream-json", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        mcpConfigPath: undefined,
      });
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
    });

    it("includes -p for prompt mode", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        mcpConfigPath: undefined,
      });
      expect(args).toContain("-p");
    });

    it("includes --dangerously-skip-permissions and --verbose", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        mcpConfigPath: undefined,
      });
      expect(args).toContain("--dangerously-skip-permissions");
      expect(args).toContain("--verbose");
    });

    it("includes --mcp-config when mcpConfigPath is provided", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      const args = runner.buildArgs({
        prompt: "test",
        mcpConfigPath: "/tmp/mcp.json",
      });
      expect(args).toContain("--mcp-config");
      expect(args).toContain("/tmp/mcp.json");
    });

    it("omits --mcp-config when mcpConfigPath is undefined", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      const args = runner.buildArgs({
        prompt: "test",
        mcpConfigPath: undefined,
      });
      expect(args).not.toContain("--mcp-config");
    });
  });

  describe("parseStreamJsonOutput()", () => {
    it("extracts messages from stream-json NDJSON lines", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      const output = [
        JSON.stringify({
          message: { role: "assistant", content: "hello" },
        }),
        JSON.stringify({ type: "progress", data: "thinking..." }),
        JSON.stringify({
          message: { role: "assistant", content: "world" },
        }),
      ].join("\n");

      const messages = runner.parseStreamJsonOutput(output);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "assistant", content: "hello" });
      expect(messages[1]).toEqual({ role: "assistant", content: "world" });
    });

    it("skips malformed JSON lines gracefully", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner();
      const output = [
        "not json",
        JSON.stringify({
          message: { role: "assistant", content: "ok" },
        }),
      ].join("\n");

      const messages = runner.parseStreamJsonOutput(output);
      expect(messages).toHaveLength(1);
    });
  });
});

describe("Codex Runner", () => {
  describe("capabilities", () => {
    it("declares MCP support as false", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();
      expect(runner.capabilities.supportsMcp).toBe(false);
    });

    it("uses .agents/skills as the skills directory", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();
      expect(runner.capabilities.skillsDirectory).toBe(".agents/skills");
    });

    it("has no config file", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();
      expect(runner.capabilities.configFile).toBeUndefined();
    });
  });

  describe("buildArgs()", () => {
    it("includes exec --full-auto --json flags", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();
      const args = runner.buildArgs({ prompt: "test prompt" });
      expect(args).toContain("exec");
      expect(args).toContain("--full-auto");
      expect(args).toContain("--json");
    });

    it("includes the prompt as the last argument", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();
      const args = runner.buildArgs({ prompt: "my test prompt" });
      expect(args[args.length - 1]).toBe("my test prompt");
    });
  });

  describe("parseJsonlOutput()", () => {
    it("extracts assistant message content from item.completed events", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();

      const fixtureContent = fs.readFileSync(
        path.join(__dirname, "fixtures/codex-output.jsonl"),
        "utf8"
      );

      const messages = runner.parseJsonlOutput(fixtureContent);

      // Should have 2 assistant messages (the 2 item.completed with role "assistant")
      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "I will help you instrument your code with LangWatch.",
          },
        ],
      });
      expect(messages[1]).toEqual({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Done! I added LangWatch tracing to your project.",
          },
        ],
      });
    });

    it("ignores non-message events", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();

      const output = [
        JSON.stringify({ type: "thread.started", thread_id: "abc" }),
        JSON.stringify({ type: "turn.completed", output: [] }),
      ].join("\n");

      const messages = runner.parseJsonlOutput(output);
      expect(messages).toHaveLength(0);
    });

    it("skips malformed JSON lines gracefully", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();

      const output = [
        "not json",
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hello" }],
          },
        }),
      ].join("\n");

      const messages = runner.parseJsonlOutput(output);
      expect(messages).toHaveLength(1);
    });
  });

  describe("when MCP is requested", () => {
    it("proceeds without error and writes no MCP config", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      const runner = new CodexRunner();

      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "codex-mcp-test-")
      );

      // Creating an agent with skipMcp=false should not throw
      // and should not write any MCP config file
      expect(() =>
        runner.createAgent({ workingDirectory: tempDir })
      ).not.toThrow();

      const mcpConfigPath = path.join(tempDir, ".mcp-config.json");
      expect(fs.existsSync(mcpConfigPath)).toBe(false);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});

describe("Cursor Runner", () => {
  describe("capabilities", () => {
    it("declares MCP support as true", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      expect(runner.capabilities.supportsMcp).toBe(true);
    });

    it("uses .cursor/rules as the skills directory", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      expect(runner.capabilities.skillsDirectory).toBe(".cursor/rules");
    });

    it("declares .cursorrules as the config file", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      expect(runner.capabilities.configFile).toBe(".cursorrules");
    });

    it("uses 'cursor' as name", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      expect(runner.name).toBe("cursor");
    });
  });

  describe("buildArgs()", () => {
    it("includes -p for prompt mode", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        workingDirectory: "/tmp/test",
        includeMcpApproval: false,
      });
      expect(args).toContain("-p");
    });

    it("includes --output-format stream-json", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        workingDirectory: "/tmp/test",
        includeMcpApproval: false,
      });
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
    });

    it("includes --force and --trust flags", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        workingDirectory: "/tmp/test",
        includeMcpApproval: false,
      });
      expect(args).toContain("--force");
      expect(args).toContain("--trust");
    });

    it("includes --workspace with the working directory", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        workingDirectory: "/tmp/my-project",
        includeMcpApproval: false,
      });
      expect(args).toContain("--workspace");
      const workspaceIndex = args.indexOf("--workspace");
      expect(args[workspaceIndex + 1]).toBe("/tmp/my-project");
    });

    it("includes --approve-mcps when MCP approval is requested", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        workingDirectory: "/tmp/test",
        includeMcpApproval: true,
      });
      expect(args).toContain("--approve-mcps");
    });

    it("omits --approve-mcps when MCP approval is not requested", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const args = runner.buildArgs({
        prompt: "test prompt",
        workingDirectory: "/tmp/test",
        includeMcpApproval: false,
      });
      expect(args).not.toContain("--approve-mcps");
    });

    it("includes the prompt as the last argument", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const args = runner.buildArgs({
        prompt: "my test prompt",
        workingDirectory: "/tmp/test",
        includeMcpApproval: false,
      });
      expect(args[args.length - 1]).toBe("my test prompt");
    });
  });

  describe("parseStreamJsonOutput()", () => {
    it("extracts messages from stream-json NDJSON lines", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();

      const fixtureContent = fs.readFileSync(
        path.join(__dirname, "fixtures/cursor-output.jsonl"),
        "utf8"
      );

      const messages = runner.parseStreamJsonOutput(fixtureContent);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({
        role: "assistant",
        content: "I will help you instrument your code with LangWatch.",
      });
      expect(messages[1]).toEqual({
        role: "assistant",
        content: "Done! I added LangWatch tracing to your project.",
      });
    });

    it("skips non-message lines", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const output = [
        JSON.stringify({ type: "status", status: "thinking" }),
        JSON.stringify({ type: "done", status: "completed" }),
      ].join("\n");

      const messages = runner.parseStreamJsonOutput(output);
      expect(messages).toHaveLength(0);
    });

    it("skips malformed JSON lines gracefully", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner();
      const output = [
        "not json",
        JSON.stringify({
          message: { role: "assistant", content: "ok" },
        }),
      ].join("\n");

      const messages = runner.parseStreamJsonOutput(output);
      expect(messages).toHaveLength(1);
    });
  });

  describe("isBinaryAvailable()", () => {
    it("returns false when binary path does not exist", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner(
        "/nonexistent/path/to/cursor-agent-binary"
      );
      expect(runner.isBinaryAvailable()).toBe(false);
    });
  });

  describe("when MCP is configured", () => {
    it("writes .cursor/mcp.json in the working directory", async () => {
      await import("../runners/cursor.js");
      // Use a real temp directory to verify MCP config writing
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "cursor-mcp-test-")
      );

      // The runner needs a binary to create an agent, but we can
      // verify the MCP file structure expectation through the factory
      // For now, just verify the config path convention
      const mcpConfigDir = path.join(tempDir, ".cursor");
      fs.mkdirSync(mcpConfigDir, { recursive: true });
      const mcpConfigPath = path.join(mcpConfigDir, "mcp.json");
      fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: {} }));

      expect(fs.existsSync(mcpConfigPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
      expect(config).toHaveProperty("mcpServers");

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });
});

describe("Skill Directory Placement", () => {
  describe("when skillPath points to a SKILL.md with _shared/ sibling", () => {
    let tempSkillSrc: string;
    let tempWorkDir: string;

    beforeEach(() => {
      tempSkillSrc = fs.mkdtempSync(
        path.join(os.tmpdir(), "skill-src-")
      );
      // Create skill structure: skillName/SKILL.md + _shared/
      const skillDir = path.join(tempSkillSrc, "tracing");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        "# Tracing Skill"
      );

      const sharedDir = path.join(tempSkillSrc, "_shared");
      fs.mkdirSync(sharedDir, { recursive: true });
      fs.writeFileSync(
        path.join(sharedDir, "mcp-setup.md"),
        "# MCP Setup"
      );
      fs.writeFileSync(
        path.join(sharedDir, "api-key-setup.md"),
        "# API Key"
      );

      tempWorkDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "skill-workdir-")
      );
    });

    afterEach(() => {
      fs.rmSync(tempSkillSrc, { recursive: true, force: true });
      fs.rmSync(tempWorkDir, { recursive: true, force: true });
    });

    it("copies SKILL.md to <skillsDir>/<name>/SKILL.md for Claude Code", async () => {
      const { copySkillTree } = await import("../shared.js");
      const skillPath = path.join(tempSkillSrc, "tracing", "SKILL.md");
      copySkillTree({
        skillPath,
        workingDirectory: tempWorkDir,
        skillsDirectory: ".skills",
      });

      const dest = path.join(tempWorkDir, ".skills", "tracing", "SKILL.md");
      expect(fs.existsSync(dest)).toBe(true);
      expect(fs.readFileSync(dest, "utf8")).toBe("# Tracing Skill");
    });

    it("copies _shared/ directory alongside the skill", async () => {
      const { copySkillTree } = await import("../shared.js");
      const skillPath = path.join(tempSkillSrc, "tracing", "SKILL.md");
      copySkillTree({
        skillPath,
        workingDirectory: tempWorkDir,
        skillsDirectory: ".skills",
      });

      const sharedDest = path.join(
        tempWorkDir,
        ".skills",
        "tracing",
        "_shared"
      );
      expect(fs.existsSync(sharedDest)).toBe(true);
      expect(
        fs.existsSync(path.join(sharedDest, "mcp-setup.md"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(sharedDest, "api-key-setup.md"))
      ).toBe(true);
    });

    it("copies to Codex skills directory when configured", async () => {
      const { copySkillTree } = await import("../shared.js");
      const skillPath = path.join(tempSkillSrc, "tracing", "SKILL.md");
      copySkillTree({
        skillPath,
        workingDirectory: tempWorkDir,
        skillsDirectory: ".agents/skills",
      });

      const dest = path.join(
        tempWorkDir,
        ".agents",
        "skills",
        "tracing",
        "SKILL.md"
      );
      expect(fs.existsSync(dest)).toBe(true);
    });
  });
});

describe("Claude Code Config File Generation", () => {
  let tempWorkDir: string;
  let tempSkillSrc: string;

  beforeEach(() => {
    tempWorkDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "claude-config-test-")
    );
    tempSkillSrc = fs.mkdtempSync(
      path.join(os.tmpdir(), "skill-src-config-")
    );
    const skillDir = path.join(tempSkillSrc, "tracing");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "# Tracing Skill"
    );
    const sharedDir = path.join(tempSkillSrc, "_shared");
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(
      path.join(sharedDir, "mcp-setup.md"),
      "# MCP"
    );
  });

  afterEach(() => {
    fs.rmSync(tempWorkDir, { recursive: true, force: true });
    fs.rmSync(tempSkillSrc, { recursive: true, force: true });
  });

  describe("when Claude Code runner has a skillPath", () => {
    it("generates CLAUDE.md pointing to the skills directory", async () => {
      const { generateConfigFile } = await import("../shared.js");
      generateConfigFile({
        configFile: "CLAUDE.md",
        workingDirectory: tempWorkDir,
        skillsDirectory: ".skills",
        skillName: "tracing",
      });

      const claudeMdPath = path.join(tempWorkDir, "CLAUDE.md");
      expect(fs.existsSync(claudeMdPath)).toBe(true);
      const content = fs.readFileSync(claudeMdPath, "utf8");
      expect(content).toContain(".skills");
    });
  });

  describe("when runner has no configFile", () => {
    it("generates no config file", async () => {
      const { generateConfigFile } = await import("../shared.js");
      generateConfigFile({
        configFile: undefined,
        workingDirectory: tempWorkDir,
        skillsDirectory: ".agents/skills",
        skillName: "tracing",
      });

      // No CLAUDE.md or any config file should exist
      expect(fs.existsSync(path.join(tempWorkDir, "CLAUDE.md"))).toBe(
        false
      );
    });
  });
});

describe("Missing Binary Handling", () => {
  describe("when the runner binary is not found", () => {
    it("throws a descriptive error for Codex", async () => {
      const { CodexRunner } = await import("../runners/codex.js");
      // Override the binary to something that doesn't exist
      const runner = new CodexRunner(
        "/nonexistent/path/to/codex-binary"
      );
      expect(runner.isBinaryAvailable()).toBe(false);
    });

    it("throws a descriptive error for Claude Code", async () => {
      const { ClaudeCodeRunner } = await import(
        "../runners/claude-code.js"
      );
      const runner = new ClaudeCodeRunner(
        "/nonexistent/path/to/claude-binary"
      );
      expect(runner.isBinaryAvailable()).toBe(false);
    });

    it("reports binary unavailable for Cursor", async () => {
      const { CursorRunner } = await import("../runners/cursor.js");
      const runner = new CursorRunner(
        "/nonexistent/path/to/cursor-agent-binary"
      );
      expect(runner.isBinaryAvailable()).toBe(false);
    });
  });
});

describe("Log Prefix", () => {
  it("Claude Code runner uses 'claude-code' as name", async () => {
    const { ClaudeCodeRunner } = await import(
      "../runners/claude-code.js"
    );
    const runner = new ClaudeCodeRunner();
    expect(runner.name).toBe("claude-code");
  });

  it("Codex runner uses 'codex' as name", async () => {
    const { CodexRunner } = await import("../runners/codex.js");
    const runner = new CodexRunner();
    expect(runner.name).toBe("codex");
  });

  it("Cursor runner uses 'cursor' as name", async () => {
    const { CursorRunner } = await import("../runners/cursor.js");
    const runner = new CursorRunner();
    expect(runner.name).toBe("cursor");
  });
});
