/**
 * The setup instructions the "copy a prompt" menu hands to a coding
 * agent: the skill's own text, with the project's credentials in front
 * of it when the reader already minted a token.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import bodies from "./setupSkillBodies.generated.json";

export type SetupSkillId = keyof typeof bodies;

export function isSetupSkillId(id: string): id is SetupSkillId {
  return Object.hasOwn(bodies, id);
}

/**
 * The credentials block a reader gets when a token was minted for them.
 * Written as env lines because that is how every LangWatch SDK reads
 * them, so the agent can put the block straight into a `.env`.
 */
export function credentialsHeader({
  apiKey,
  projectId,
  endpoint,
}: {
  apiKey: string;
  projectId: string;
  endpoint?: string;
}): string {
  const lines = [
    `LANGWATCH_API_KEY="${apiKey}"`,
    `LANGWATCH_PROJECT_ID="${projectId}"`,
    ...(endpoint ? [`LANGWATCH_ENDPOINT="${endpoint}"`] : []),
  ];
  return `Use these keys to instrument:

\`\`\`
${lines.join("\n")}
\`\`\``;
}

/** The skill's instructions, and the credentials above them when there are any. */
export function setupPrompt({
  skill,
  credentials,
}: {
  skill: SetupSkillId;
  credentials?: { apiKey: string; projectId: string; endpoint?: string };
}): string {
  const body = bodies[skill];
  if (!credentials) return body;
  return `${credentialsHeader(credentials)}

${body}`;
}
