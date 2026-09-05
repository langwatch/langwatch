/**
 * The address of a span opened in the Prompt Studio.
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
