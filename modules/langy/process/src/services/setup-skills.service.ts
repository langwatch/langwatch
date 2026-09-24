/**
 * The skill instructions the "copy a prompt" menu hands to a coding agent.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { NotFoundError } from "@langwatch/handled-error";

import { SETUP_SKILL_BODIES } from "../rules/setup-skill-bodies.rules.ts";

export type SetupSkillId = keyof typeof SETUP_SKILL_BODIES;

/** Serves the skill instructions the "copy a prompt" menu hands to an agent. */
export class SetupSkillsService {
  private constructor() {}

  static create(): SetupSkillsService {
    return new SetupSkillsService();
  }

  isSetupSkillId(id: string): id is SetupSkillId {
    return Object.hasOwn(SETUP_SKILL_BODIES, id);
  }

  /** The prompt the menu copies; an unknown skill is the handled 404 `not_found`. */
  async getPrompt({ skill }: { skill: string }): Promise<{ body: string }> {
    if (!this.isSetupSkillId(skill)) {
      throw new NotFoundError("not_found", "Setup guide", skill);
    }
    return { body: this.body(skill) };
  }

  /** The skill's own text, front matter already stripped by the generator. */
  body(skill: SetupSkillId): string {
    return SETUP_SKILL_BODIES[skill];
  }
}
