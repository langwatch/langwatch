/**
 * Wire-protocol markers Langy can emit inside assistant text.
 *
 * Sentinels are stripped at TWO places: persistence (so chat history doesn't
 * carry raw markers) and rendering (so the user never sees them flash through
 * a streaming text-delta). Both code paths must use the SAME constants and
 * the SAME strip helper — divergence is what surfaces as "the connect card
 * keeps reappearing on history reload" or "raw `[langy:progress:...]` in my
 * exported transcript".
 *
 * The sentinels:
 *   [langy:connect-github]            — the assistant wants the sidebar to
 *                                       render the in-chat Connect GitHub
 *                                       card. Single occurrence per reply.
 *   [langy:progress:<stage>:<detail>] — live PR-opening progress markers,
 *                                       multiple per reply, in order; see
 *                                       githubProgressEvents.ts for parsing.
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */
import { parseGithubProgressEvents } from "./githubProgressEvents";

export const CONNECT_GITHUB_SENTINEL = "[langy:connect-github]";

/**
 * Remove every Langy sentinel from `text`. Use at persistence time and at
 * UI render time so the two paths stay in lockstep. Returns the cleaned
 * text — does not return the parsed events (use the per-sentinel parsers
 * for that — `parseGithubProgressEvents`, `text.includes(CONNECT_GITHUB_SENTINEL)`).
 */
export function stripLangySentinels(text: string): string {
  const withoutConnect = text.split(CONNECT_GITHUB_SENTINEL).join("");
  return parseGithubProgressEvents(withoutConnect).cleanedText;
}
