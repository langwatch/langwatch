import { api } from "../trace-api.ts";

type TraceRead = {
  projectId: string;
  traceId: string;
  occurredAtMs: number | undefined;
  /** The member that owns the trace on an aggregate (ADR-177 block F). */
  tenantId?: string | null;
};

export function useSpansFullRead({
  projectId,
  traceId,
  occurredAtMs,
  tenantId,
  enabled = true,
}: TraceRead & { enabled?: boolean }) {
  return api.traces.spansFull.useQuery(
    { projectId, traceId, occurredAtMs, ...(tenantId ? { tenantId } : {}) },
    { enabled },
  );
}

export function useTraceEventsRead({ projectId, traceId, occurredAtMs, tenantId }: TraceRead) {
  return api.traces.traceEvents.useQuery({
    projectId,
    traceId,
    occurredAtMs,
    ...(tenantId ? { tenantId } : {}),
  });
}

export function useResourceInfoRead({ projectId, traceId, occurredAtMs, tenantId }: TraceRead) {
  return api.traces.resourceInfo.useQuery({
    projectId,
    traceId,
    occurredAtMs,
    ...(tenantId ? { tenantId } : {}),
  });
}
