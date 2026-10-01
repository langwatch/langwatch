/**
 * The guided onboarding kickoff: the user message the app sends when the
 * sign-up tour ends. The runner recognises it by its opener and places the
 * skill's body ahead of it, the way a slash skill expands.
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
  const message = labelAt === -1 ? prompt : prompt.slice(labelAt + USER_MESSAGE_LABEL.length);
  const lines = message.trim().split("\n");
  const first = lines[0]?.trim() ?? "";
  if (first.startsWith(GUIDED_KICKOFF_OPENER)) return true;
  const second = lines[1]?.trim() ?? "";
  return GUIDED_KICKOFF_CONTINUATION.test(first) && second.startsWith(GUIDED_KICKOFF_OPENER);
}

/** A conversation whose history carries the kickoff brief is on the guided path. */
export function historyHasGuidedKickoff(messages: readonly unknown[]): boolean {
  return messages.some((message) => {
    if (typeof message !== "object" || message === null) return false;
    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== "user") return false;
    if (typeof content === "string") return content.includes(GUIDED_KICKOFF_OPENER);
    if (!Array.isArray(content)) return false;
    return content.some(
      (block) =>
        typeof block === "object" &&
        block !== null &&
        typeof (block as { text?: unknown }).text === "string" &&
        (block as { text: string }).text.includes(GUIDED_KICKOFF_OPENER),
    );
  });
}

/**
 * Whether the turn is on the guided path, from the composed prompt (read
 * whole, not from the last user-message label) and the history.
 */
export function isGuidedTurn({
  prompt,
  history,
}: {
  prompt: string;
  history: readonly unknown[];
}): boolean {
  return prompt.includes(GUIDED_KICKOFF_OPENER) || historyHasGuidedKickoff(history);
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

/**
 * What the `skill` tool answers when the model loads the guided onboarding
 * skill outside the guided path: left unguarded, a bare first message in a
 * fresh conversation loaded it and ran the path's first step anyway.
 */
export const GUIDED_SKILL_REFUSAL =
  "The guided-onboarding skill is the script for the kickoff brief the app sends when the sign-up tour ends, and this conversation has no kickoff. Do not set up a path: answer the message as it is.";

export function guidedSkillRefusal({
  name,
  guided,
}: {
  name: string;
  guided: boolean;
}): string | undefined {
  if (name !== GUIDED_ONBOARDING_SKILL_NAME || guided) return undefined;
  return GUIDED_SKILL_REFUSAL;
}
