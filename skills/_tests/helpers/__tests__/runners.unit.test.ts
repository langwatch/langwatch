import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ClaudeCodeRunner } from "../runners/claude-code";
import { CodexRunner } from "../runners/codex";
import { CursorRunner } from "../runners/cursor";

describe("ClaudeCodeRunner", () => {
  describe("capabilities", () => {
    it("declares MCP support", () => {
      const runner = new ClaudeCodeRunner();
      expect(runner.capabilities.supportsMcp).toBe(true);
    });

    it("uses .skills as the skills directory", () => {
      const runner = new ClaudeCodeRunner();
      expect(runner.capabilities.skillsDirectory).toBe(".skills");
    });

    it("uses CLAUDE.md as the config file", () => {
      const runner = new ClaudeCodeRunner();
      expect(runner.capabilities.configFile).toBe("CLAUDE.md");
    });

    it("has name claude-code", () => {
      const runner = new ClaudeCodeRunner();
      expect(runner.name).toBe("claude-code");
    });
  });

  describe("createAgent()", () => {
    describe("when skillPath is provided", () => {
      it("copies SKILL.md to .skills/<name>/SKILL.md", () => {
        const runner = new ClaudeCodeRunner();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-runner-test-"));

        // Create a fake SKILL.md
        const skillSrcDir = path.join(tempDir, "src", "my-skill");
        fs.mkdirSync(skillSrcDir, { recursive: true });
        const skillPath = path.join(skillSrcDir, "SKILL.md");
        fs.writeFileSync(skillPath, "# Test Skill");

        const workDir = path.join(tempDir, "work");
        fs.mkdirSync(workDir, { recursive: true });

        runner.createAgent({
          workingDirectory: workDir,
          skillPath,
        });

        const placed = path.join(workDir, ".skills", "my-skill", "SKILL.md");
        expect(fs.existsSync(placed)).toBe(true);
        expect(fs.readFileSync(placed, "utf8")).toBe("# Test Skill");

        // Verify CLAUDE.md was generated
        const claudeMd = path.join(workDir, "CLAUDE.md");
        expect(fs.existsSync(claudeMd)).toBe(true);
        expect(fs.readFileSync(claudeMd, "utf8")).toContain(".skills/my-skill/SKILL.md");
      });
    });
  });
});

describe("CodexRunner", () => {
  describe("capabilities", () => {
    it("declares no MCP support", () => {
      const runner = new CodexRunner();
      expect(runner.capabilities.supportsMcp).toBe(false);
    });

    it("uses .agents/skills as the skills directory", () => {
      const runner = new CodexRunner();
      expect(runner.capabilities.skillsDirectory).toBe(".agents/skills");
    });

    it("has no config file", () => {
      const runner = new CodexRunner();
      expect(runner.capabilities.configFile).toBeUndefined();
    });

    it("has name codex", () => {
      const runner = new CodexRunner();
      expect(runner.name).toBe("codex");
    });
  });

  describe("createAgent()", () => {
    describe("when skillPath is provided", () => {
      it("copies SKILL.md to .agents/skills/<name>/SKILL.md", () => {
        const runner = new CodexRunner();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-runner-test-"));

        const skillSrcDir = path.join(tempDir, "src", "my-skill");
        fs.mkdirSync(skillSrcDir, { recursive: true });
        const skillPath = path.join(skillSrcDir, "SKILL.md");
        fs.writeFileSync(skillPath, "# Test Skill");

        const workDir = path.join(tempDir, "work");
        fs.mkdirSync(workDir, { recursive: true });

        runner.createAgent({
          workingDirectory: workDir,
          skillPath,
        });

        const placed = path.join(workDir, ".agents", "skills", "my-skill", "SKILL.md");
        expect(fs.existsSync(placed)).toBe(true);
        expect(fs.readFileSync(placed, "utf8")).toBe("# Test Skill");

        // No config file generated
        expect(fs.existsSync(path.join(workDir, "CLAUDE.md"))).toBe(false);
      });
    });
  });
});

describe("CursorRunner", () => {
  describe("capabilities", () => {
    it("declares no MCP support", () => {
      const runner = new CursorRunner();
      expect(runner.capabilities.supportsMcp).toBe(false);
    });

    it("uses .cursor/skills as the skills directory", () => {
      const runner = new CursorRunner();
      expect(runner.capabilities.skillsDirectory).toBe(".cursor/skills");
    });

    it("has name cursor", () => {
      const runner = new CursorRunner();
      expect(runner.name).toBe("cursor");
    });
  });

  describe("createAgent()", () => {
    describe("when skillPath is provided", () => {
      it("copies SKILL.md to .cursor/skills/<name>/SKILL.md", () => {
        const runner = new CursorRunner();
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-runner-test-"));

        const skillSrcDir = path.join(tempDir, "src", "my-skill");
        fs.mkdirSync(skillSrcDir, { recursive: true });
        const skillPath = path.join(skillSrcDir, "SKILL.md");
        fs.writeFileSync(skillPath, "# Test Skill");

        const workDir = path.join(tempDir, "work");
        fs.mkdirSync(workDir, { recursive: true });

        runner.createAgent({
          workingDirectory: workDir,
          skillPath,
        });

        const placed = path.join(workDir, ".cursor", "skills", "my-skill", "SKILL.md");
        expect(fs.existsSync(placed)).toBe(true);
        expect(fs.readFileSync(placed, "utf8")).toBe("# Test Skill");
      });
    });
  });
});
