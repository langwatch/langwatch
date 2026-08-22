/**
 * The setup prompt handed to a coding agent: the skill's own text, with
 * the project's credentials above it when one was minted.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSetupSkillBodies,
  SETUP_SKILL_IDS,
  skillBody,
} from "../../../../scripts/generate-setup-skill-bodies";
import { SETUP_SURFACES } from "../../../components/SetupWithAgentButton";
import bodies from "../setupSkillBodies.generated.json";
import { isSetupSkillId, setupPrompt } from "../setupSkills.service";

const REPO_ROOT = path.resolve(__dirname, "../../../../../..");

describe("the setup skill bodies", () => {
  describe("given the surfaces that offer a setup menu", () => {
    it("ships a body for every skill a surface names", () => {
      for (const [surface, setup] of Object.entries(SETUP_SURFACES)) {
        expect(
          isSetupSkillId(setup.skill),
          `${surface} offers the "${setup.skill}" skill, which has no body`,
        ).toBe(true);
      }
    });

    it("keeps the generated file in step with the skills on disk", () => {
      expect(bodies).toEqual(deriveSetupSkillBodies(REPO_ROOT));
    });

    it("lists the same skills the surfaces do", () => {
      const named = new Set(
        Object.values(SETUP_SURFACES).map((setup) => setup.skill),
      );
      expect(new Set(SETUP_SKILL_IDS)).toEqual(named);
    });
  });

  describe("when the front matter is stripped", () => {
    it("keeps the instructions and drops the runtime metadata", () => {
      const raw = fs.readFileSync(
        path.join(REPO_ROOT, "skills/_compiled/native/tracing/SKILL.md"),
        "utf8",
      );
      const body = skillBody(raw);

      expect(body).toContain("# Add LangWatch Tracing to Your Code");
      expect(body).not.toContain("license: MIT");
      expect(body.startsWith("---")).toBe(false);
    });
  });
});

describe("setupPrompt()", () => {
  describe("given no token was minted", () => {
    it("hands over the skill on its own", () => {
      const prompt = setupPrompt({ skill: "tracing" });

      expect(prompt).toBe(bodies.tracing);
      expect(prompt).not.toContain("LANGWATCH_API_KEY");
    });
  });

  describe("given a token was minted", () => {
    it("puts the keys above the skill", () => {
      const prompt = setupPrompt({
        skill: "tracing",
        credentials: {
          apiKey: "sk-lw-abc",
          projectId: "project_1",
          endpoint: "https://app.langwatch.ai",
        },
      });

      expect(prompt.indexOf("Use these keys to instrument:")).toBe(0);
      expect(prompt).toContain('LANGWATCH_API_KEY="sk-lw-abc"');
      expect(prompt).toContain('LANGWATCH_PROJECT_ID="project_1"');
      expect(prompt).toContain('LANGWATCH_ENDPOINT="https://app.langwatch.ai"');
      expect(prompt.indexOf(bodies.tracing)).toBeGreaterThan(0);
    });

    it("leaves the endpoint out when the surface does not know it", () => {
      const prompt = setupPrompt({
        skill: "tracing",
        credentials: { apiKey: "sk-lw-abc", projectId: "project_1" },
      });

      expect(prompt).not.toContain("LANGWATCH_ENDPOINT");
    });
  });
});
