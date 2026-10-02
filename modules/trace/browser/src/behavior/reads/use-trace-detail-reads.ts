import { api } from "../trace-api.ts";

type TraceRead = {
  projectId: string;
  traceId: string;
  occurredAtMs: number | undefined;
};

export function useSpansFullRead({
  projectId,
  traceId,
  occurredAtMs,
  enabled = true,
}: TraceRead & { enabled?: boolean }) {
  return api.traces.spansFull.useQuery({ projectId, traceId, occurredAtMs }, { enabled });
}

export function useTraceEventsRead({ projectId, traceId, occurredAtMs }: TraceRead) {
  return api.traces.traceEvents.useQuery({ projectId, traceId, occurredAtMs });
}

export function useResourceInfoRead({ projectId, traceId, occurredAtMs }: TraceRead) {
  return api.traces.resourceInfo.useQuery({ projectId, traceId, occurredAtMs });
}
