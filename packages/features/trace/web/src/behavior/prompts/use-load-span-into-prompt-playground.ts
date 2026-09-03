/**
 * The address of a span opened in the Prompt Studio.
 *
 * `~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground` is the
 * prompt family's hook and it has since moved into `@langwatch/prompt-web`,
 * whose entry does not publish it. Only the URL BUILDER crossed into the trace
 * drawer — three call sites, all of them "open this span in the playground" —
 * and building a URL needs neither the studio's tab store nor its loader. So
 * this is the builder, narrowed, with the two query parameter names spelled the
 * way the studio still reads them.
 *
 * The two names are a restatement and carry the alignment obligation: rename
 * one here without renaming it there and the studio opens an empty tab.
 */

import { useOrganizationTeamProject } from "../use-organization-team-project";

export const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";
export const QUERY_PARAM_ACTION = "action";

export type PlaygroundAction = "open-existing" | "create-new";

export function useGoToSpanInPlaygroundTabUrlBuilder() {
  const { project } = useOrganizationTeamProject();

  const buildUrl = (spanId: string, action?: PlaygroundAction) => {
    if (!project?.slug) return null;
    const url = new URL(`/${project.slug}/prompts`, window.location.origin);
    url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID, spanId);
    if (action) url.searchParams.set(QUERY_PARAM_ACTION, action);
    return url;
  };

  return { buildUrl };
}
