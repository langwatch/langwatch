/**
 * The text the "copy a prompt" menu hands to a coding agent: the skill's own instructions, with the project's
 * credentials in front of them when the reader already minted a token.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */

export type SetupCredentials = {
  apiKey: string;
  projectId: string;
  /** Set only on a self-hosted deployment, where the SDK default misses. */
  endpoint?: string;
};

/**
 * The credentials block a reader gets when a token was minted for them.
 * Written as env lines because that is how every LangWatch SDK reads
 * them, so the agent can put the block straight into a `.env`.
 */
export function credentialsHeader({ apiKey, projectId, endpoint }: SetupCredentials): string {
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
export function withCredentials({
  body,
  credentials,
}: {
  body: string;
  credentials?: SetupCredentials;
}): string {
  if (!credentials) return body;
  return `${credentialsHeader(credentials)}

${body}`;
}
