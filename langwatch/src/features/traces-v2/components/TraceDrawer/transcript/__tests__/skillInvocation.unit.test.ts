import { describe, expect, it } from "vitest";

import {
  isSkillToolName,
  skillInvocationFromToolUse,
  skillSlugFromInput,
} from "../skillInvocation";

describe("skillInvocation", () => {
  describe("isSkillToolName", () => {
    describe("given the Skill tool name", () => {
      it("recognizes it as a skill", () => {
        expect(isSkillToolName("Skill")).toBe(true);
      });
    });

    describe("given an ordinary tool name", () => {
      it("does not treat Bash as a skill", () => {
        expect(isSkillToolName("Bash")).toBe(false);
      });

      it("handles null/undefined", () => {
        expect(isSkillToolName(null)).toBe(false);
        expect(isSkillToolName(undefined)).toBe(false);
      });
    });
  });

  describe("skillSlugFromInput", () => {
    describe("when the input carries a skill slug", () => {
      it("extracts the skill name", () => {
        expect(skillSlugFromInput({ skill: "surf-pr", args: "" })).toBe(
          "surf-pr",
        );
      });

      it("trims surrounding whitespace", () => {
        expect(skillSlugFromInput({ skill: "  ruthless-review  " })).toBe(
          "ruthless-review",
        );
      });

      it("honors the skill_name alias", () => {
        expect(skillSlugFromInput({ skill_name: "code-review" })).toBe(
          "code-review",
        );
      });
    });

    describe("when the slug is absent or unusable", () => {
      it("returns null for a blank slug", () => {
        expect(skillSlugFromInput({ skill: "   " })).toBeNull();
      });

      it("returns null for a non-object input", () => {
        expect(skillSlugFromInput("surf-pr")).toBeNull();
        expect(skillSlugFromInput(null)).toBeNull();
        expect(skillSlugFromInput(["skill"])).toBeNull();
      });
    });
  });

  describe("skillInvocationFromToolUse", () => {
    describe("when the tool_use is a Skill run", () => {
      it("resolves to the skill with its slug", () => {
        expect(
          skillInvocationFromToolUse({
            name: "Skill",
            input: { skill: "surf-pr" },
          }),
        ).toEqual({ slug: "surf-pr" });
      });

      it("resolves with a null slug when the input has none", () => {
        expect(
          skillInvocationFromToolUse({ name: "Skill", input: {} }),
        ).toEqual({ slug: null });
      });
    });

    describe("when the tool_use is an ordinary tool", () => {
      it("returns null for Bash", () => {
        expect(
          skillInvocationFromToolUse({
            name: "Bash",
            input: { command: "ls" },
          }),
        ).toBeNull();
      });
    });
  });
});
