import { useGoToSpanInPlaygroundTabUrlBuilder } from "~/prompts/prompt-playground/hooks/useLoadSpanIntoPromptPlayground";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/**
 * The link that opens a span of the open trace in the prompt playground. It
 * names the trace, the member that holds it under an aggregate and its time
 * hint, so the playground reads the span through the trace's own proof
 * (ADR-144 block F) instead of looking it up in the URL project, which under
 * an aggregate holds no spans. Empty when no link can be built.
 */
export function useSpanPlaygroundHref(): (spanId: string) => string {
  const { buildUrl } = useGoToSpanInPlaygroundTabUrlBuilder();
  const { traceId, tenantId, occurredAtMs } = useTraceQueryArgs();

  return (spanId) =>
    buildUrl({
      spanId,
      ...(traceId ? { trace: { traceId, tenantId, occurredAtMs } } : {}),
    })?.toString() ?? "";
}
