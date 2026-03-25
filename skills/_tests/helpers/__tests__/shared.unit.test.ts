import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { toolCallFix, assertSkillWasRead, placeSkill } from "../shared";

describe("toolCallFix()", () => {
  describe("when message has non-text content blocks", () => {
    it("converts them to text blocks with JSON", () => {
      const state = {
        messages: [
          {
            role: "assistant" as const,
            content: [
              { type: "text", text: "hello" },
              { type: "tool_use", id: "123", name: "read", input: {} },
            ],
          },
        ],
      };

      toolCallFix(state);

      expect((state.messages[0]!.content as any[])[0]).toEqual({
        type: "text",
        text: "hello",
      });
      expect((state.messages[0]!.content as any[])[1]).toEqual({
        type: "text",
        text: JSON.stringify({
          type: "tool_use",
          id: "123",
          name: "read",
          input: {},
        }),
      });
    });
  });

  describe("when message has only text content", () => {
    it("leaves it unchanged", () => {
      const state = {
        messages: [
          {
            role: "assistant" as const,
            content: [{ type: "text", text: "hello" }],
          },
        ],
      };

      toolCallFix(state);

      expect((state.messages[0]!.content as any[])[0]).toEqual({
        type: "text",
        text: "hello",
      });
    });
  });
});

describe("assertSkillWasRead()", () => {
  describe("when SKILL.md is mentioned in messages", () => {
    it("does not throw", () => {
      const state = {
        messages: [
          {
            role: "assistant" as const,
            content: "I read the SKILL.md file and followed its instructions.",
          },
        ],
      };

      expect(() => assertSkillWasRead(state, "tracing")).not.toThrow();
    });
  });

  describe("when .skills/name path is in messages", () => {
    it("does not throw", () => {
      const state = {
        messages: [
          {
            role: "assistant" as const,
            content: "Reading .skills/tracing/SKILL.md...",
          },
        ],
      };

      expect(() => assertSkillWasRead(state, "tracing")).not.toThrow();
    });
  });

  describe("when skills/name path is in messages", () => {
    it("does not throw", () => {
      const state = {
        messages: [
          {
            role: "assistant" as const,
            content: "Found skills/tracing/SKILL.md in the directory.",
          },
        ],
      };

      expect(() => assertSkillWasRead(state, "tracing")).not.toThrow();
    });
  });

  describe("when no evidence of skill reading is found", () => {
    it("throws an error with the skill name", () => {
      const state = {
        messages: [
          {
            role: "assistant" as const,
            content: "I will now instrument your code.",
          },
        ],
      };

      expect(() => assertSkillWasRead(state, "tracing")).toThrow(
        "Expected agent to read the tracing SKILL.md file"
      );
    });
  });
});

describe("placeSkill()", () => {
  describe("when given a valid skill path", () => {
    it("copies SKILL.md to skillsDirectory/<name>/SKILL.md", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "placeskill-test-"));

      // Create a fake SKILL.md source
      const skillSrcDir = path.join(tempDir, "src", "my-skill");
      fs.mkdirSync(skillSrcDir, { recursive: true });
      const skillPath = path.join(skillSrcDir, "SKILL.md");
      fs.writeFileSync(skillPath, "# My Skill");

      const workDir = path.join(tempDir, "work");
      fs.mkdirSync(workDir, { recursive: true });

      placeSkill({
        workingDirectory: workDir,
        skillsDirectory: ".custom/skills",
        skillPath,
      });

      const placed = path.join(workDir, ".custom", "skills", "my-skill", "SKILL.md");
      expect(fs.existsSync(placed)).toBe(true);
      expect(fs.readFileSync(placed, "utf8")).toBe("# My Skill");
    });
  });

  describe("when the target directory does not exist", () => {
    it("creates the directory recursively", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "placeskill-test-"));

      const skillSrcDir = path.join(tempDir, "src", "deep-skill");
      fs.mkdirSync(skillSrcDir, { recursive: true });
      const skillPath = path.join(skillSrcDir, "SKILL.md");
      fs.writeFileSync(skillPath, "# Deep Skill");

      const workDir = path.join(tempDir, "work");
      // Intentionally do not create workDir -- placeSkill uses recursive mkdir

      placeSkill({
        workingDirectory: workDir,
        skillsDirectory: "a/b/c",
        skillPath,
      });

      const placed = path.join(workDir, "a", "b", "c", "deep-skill", "SKILL.md");
      expect(fs.existsSync(placed)).toBe(true);
    });
  });
});
