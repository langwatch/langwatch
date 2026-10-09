/**
 * The skill bodies the setup menus serve to a coding agent, and the
 * generated file staying in step with the skills on disk.
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
import { isSetupSkillId, setupSkillBody } from "../setupSkills.service";

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

  describe("setupSkillBody()", () => {
    /** @scenario The copied prompt carries the skill's own instructions */
    it("serves the whole skill rather than a line pointing at it", () => {
      const body = setupSkillBody("tracing");

      expect(body).toBe(bodies.tracing);
      expect(body).toContain("# Add LangWatch Tracing to Your Code");
      expect(body).not.toContain("npx skills add");
    });

    it("carries no credentials of its own", () => {
      for (const id of SETUP_SKILL_IDS) {
        expect(setupSkillBody(id)).not.toContain("LANGWATCH_API_KEY=");
      }
    });
  });
});
