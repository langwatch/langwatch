/**
 * The guided onboarding kickoff, as the worker recognises it.
 *
 * The kickoff is the user message the app sends when the sign-up tour ends.
 * Its brief opens with a fixed line and then names what the tour collected.
 * The turn that carries it needs the guided-onboarding skill in context from
 * the start: left to the routing row and the `skill` tool, the model acted on
 * the onboarding CLI tools it could see and never read the script. So the
 * runner recognises the brief by its opener and places the skill's body ahead
 * of the message, the way a slash skill expands, and the brief stays the
 * script's input.
 *
 * The opener is app-owned copy (`GUIDED_KICKOFF_BRIEF_OPENER` in the app's
 * guided-onboarding kickoff module); the two sides pin the same literal.
 */

export const GUIDED_ONBOARDING_SKILL_NAME = "guided-onboarding";

/** The first line of every kickoff brief. */
export const GUIDED_KICKOFF_OPENER = "Guided onboarding kickoff.";

/**
 * A later kickoff in the same conversation opens with the continuation line
 * ("Let's set up Gateway then.") and the brief opener follows on the next line.
 */
const GUIDED_KICKOFF_CONTINUATION = /^Let's set up .+ then\.$/;

/**
 * The label the app puts between prepended data (screen context, a folded
 * history seed) and the user's own words. The kickoff brief is what follows
 * the last one when it is present, and the whole prompt otherwise.
 */
const USER_MESSAGE_LABEL = "THE USER'S MESSAGE:";

export function isGuidedKickoffPrompt(prompt: string): boolean {
  const labelAt = prompt.lastIndexOf(USER_MESSAGE_LABEL);
  const message =
    labelAt === -1 ? prompt : prompt.slice(labelAt + USER_MESSAGE_LABEL.length);
  const lines = message.trim().split("\n");
  const first = lines[0]?.trim() ?? "";
  if (first.startsWith(GUIDED_KICKOFF_OPENER)) return true;
  const second = lines[1]?.trim() ?? "";
  return GUIDED_KICKOFF_CONTINUATION.test(first) && second.startsWith(GUIDED_KICKOFF_OPENER);
}

/** The skill's body ahead of the message, framed the way the resume seed is. */
export function prependSkillBody({
  prompt,
  name,
  body,
}: {
  prompt: string;
  name: string;
  body: string;
}): string {
  return [
    `[Skill "${name}", loaded for this turn. It is the script for the message below: follow it line by line, and take no other action first.]`,
    body.trim(),
    "[End of skill. The user's message follows.]",
    "",
    prompt,
  ].join("\n");
}
