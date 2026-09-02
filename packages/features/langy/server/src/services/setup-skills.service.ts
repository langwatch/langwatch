/**
 * The skill instructions the "copy a prompt" menu hands to a coding agent.
 *
 * The credentials that go above them are joined on in the browser, which
 * already holds the minted token, so nothing here reads a secret.
 *
 * It lives in this package because the bodies do: they are generated from
 * `skills/_compiled/native/<id>/SKILL.md`, the same compiled skills the Langy
 * image ships, so the prompt a customer copies and the skill Langy runs can
 * never say different things.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { SETUP_SKILL_BODIES } from "./setup-skill-bodies.generated";

export type SetupSkillId = keyof typeof SETUP_SKILL_BODIES;

export function isSetupSkillId(id: string): id is SetupSkillId {
  return Object.hasOwn(SETUP_SKILL_BODIES, id);
}

/** The skill's own text, front matter already stripped by the generator. */
export function setupSkillBody(skill: SetupSkillId): string {
  return SETUP_SKILL_BODIES[skill];
}
