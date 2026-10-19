import { useTraceQueryArgs } from "../explorer/use-trace-query-args.ts";
import { useGoToSpanInPlaygroundTabUrlBuilder } from "./use-load-span-into-prompt-playground.ts";

/**
 * The playground link for a span of the open trace: names the trace, its member
 * and its time hint, so the span is read through the trace's proof (ADR-177 block F).
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
