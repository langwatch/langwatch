/**
 * The skill instructions the "copy a prompt" menu hands to a coding agent.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { SETUP_SKILL_BODIES } from "./setup-skill-bodies.generated";

export type SetupSkillId = keyof typeof SETUP_SKILL_BODIES;

/** Serves the skill instructions the "copy a prompt" menu hands to an agent. */
export class SetupSkillsService {
  static create(): SetupSkillsService {
    return new SetupSkillsService();
  }

  isSetupSkillId(id: string): id is SetupSkillId {
    return Object.hasOwn(SETUP_SKILL_BODIES, id);
  }

  /** The skill's own text, front matter already stripped by the generator. */
  body(skill: SetupSkillId): string {
    return SETUP_SKILL_BODIES[skill];
  }
}
