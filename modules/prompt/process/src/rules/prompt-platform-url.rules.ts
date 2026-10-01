/**
 * The platform's deep link to the prompt library, built from the app's publicBaseUrl
 * config. REST declarations are static, so links compose from config at module load time.
 * Path: /${projectSlug}/prompts (from prompt-routes.ts).
 */
const PROMPTS_PATH = "/prompts";

/** `${publicBaseUrl}/${projectSlug}/prompts`, trailing slash trimmed. */
export function promptsPlatformUrl(input: { publicBaseUrl: string; projectSlug: string }): string {
  const base = input.publicBaseUrl.replace(/\/+$/, "");

  return `${base}/${input.projectSlug}${PROMPTS_PATH}`;
}
