/**
 * The skill bodies the setup menus serve to a coding agent.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { describe, expect, it } from "vitest";
import { isSetupSkillId, setupSkillBody } from "../setup-skills.service";
import { SETUP_SKILL_BODIES } from "../setup-skill-bodies.generated";

describe("setupSkillBody()", () => {
  /** @scenario The copied prompt carries the skill's own instructions */
  it("serves the whole skill rather than a line pointing at it", () => {
    expect(isSetupSkillId("tracing")).toBe(true);
    const body = setupSkillBody("tracing");

    expect(body).toBe(SETUP_SKILL_BODIES.tracing);
    expect(body).toContain("# Add LangWatch Tracing to Your Code");
    expect(body).not.toContain("npx skills add");
  });

  it("carries no credentials of its own", () => {
    for (const id of Object.keys(SETUP_SKILL_BODIES) as Array<
      keyof typeof SETUP_SKILL_BODIES
    >) {
      expect(setupSkillBody(id)).not.toContain("LANGWATCH_API_KEY=");
    }
  });
});
