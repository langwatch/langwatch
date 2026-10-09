/**
 * The address of a span opened in the Prompt Studio. The query keys mirror the
 * prompt module's reader (use-load-span-into-prompt-studio.ts).
 */

import { useOrganizationTeamProject } from "../use-organization-team-project.ts";

export const QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID = "promptPlaygroundSpanId";
export const QUERY_PARAM_PROMPT_PLAYGROUND_TRACE_ID = "promptPlaygroundTraceId";
export const QUERY_PARAM_PROMPT_PLAYGROUND_TENANT_ID = "promptPlaygroundTenantId";
export const QUERY_PARAM_PROMPT_PLAYGROUND_OCCURRED_AT_MS = "promptPlaygroundOccurredAtMs";
export const QUERY_PARAM_ACTION = "action";

export type PlaygroundAction = "open-existing" | "create-new";

/** A span's trace; under an aggregate `tenantId` names its member (ADR-177 block F). */
export type PlaygroundSpanTrace = {
  traceId: string;
  tenantId?: string | null;
  occurredAtMs?: number | null;
};

export function useGoToSpanInPlaygroundTabUrlBuilder() {
  const { project } = useOrganizationTeamProject();

  const buildUrl = ({
    spanId,
    action,
    trace,
  }: {
    spanId: string;
    action?: PlaygroundAction;
    trace?: PlaygroundSpanTrace;
  }) => {
    if (!project?.slug) return null;
    const url = new URL(`/${project.slug}/prompts`, window.location.origin);
    url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_SPAN_ID, spanId);
    if (trace) {
      url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_TRACE_ID, trace.traceId);
      if (trace.tenantId)
        url.searchParams.set(QUERY_PARAM_PROMPT_PLAYGROUND_TENANT_ID, trace.tenantId);
      if (trace.occurredAtMs != null) {
        url.searchParams.set(
          QUERY_PARAM_PROMPT_PLAYGROUND_OCCURRED_AT_MS,
          String(trace.occurredAtMs),
        );
      }
    }
    if (action) url.searchParams.set(QUERY_PARAM_ACTION, action);
    return url;
  };

  return { buildUrl };
}
