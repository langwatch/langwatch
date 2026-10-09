/**
 * The skill instructions the "copy a prompt" menu hands to a coding
 * agent. The credentials that go above them are joined on in the
 * browser, which already holds the minted token
 * (`~/features/skills/logic/setupPrompt`).
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import bodies from "./setupSkillBodies.generated.json";

export type SetupSkillId = keyof typeof bodies;

export function isSetupSkillId(id: string): id is SetupSkillId {
  return Object.hasOwn(bodies, id);
}

/** The skill's own text, front matter already stripped by the generator. */
export function setupSkillBody(skill: SetupSkillId): string {
  return bodies[skill];
}
