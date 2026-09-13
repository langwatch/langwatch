/**
 * The platform's own deep link back into the prompt library, built from the
 * app's `publicBaseUrl` config: the same pattern
 * `modules/analytics/server/src/rules/analytics-platform-url.rules.ts` uses,
 * because a REST declaration is a static, module-load-time object with no
 * request-scoped builder to receive — the app composes the link itself from
 * config it already holds.
 *
 * The path is the one the browser answers,
 * `modules/prompt/web/src/model/prompt-routes.ts`'s `/${projectSlug}/prompts`.
 */
const PROMPTS_PATH = "/prompts";

/** `${publicBaseUrl}/${projectSlug}/prompts`, trailing slash trimmed. */
export function promptsPlatformUrl(input: {
  publicBaseUrl: string;
  projectSlug: string;
}): string {
  const base = input.publicBaseUrl.replace(/\/+$/, "");

  return `${base}/${input.projectSlug}${PROMPTS_PATH}`;
}
