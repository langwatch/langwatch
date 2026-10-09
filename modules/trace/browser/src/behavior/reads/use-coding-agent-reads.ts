import { api } from "../trace-api.ts";

export function useCodingAgentSession({
  projectId,
  traceId,
}: {
  projectId: string;
  traceId: string;
}) {
  return api.codingAgents.session.useQuery({ projectId, traceId });
}

export function useCodingAgentTranscript({
  projectId,
  traceId,
  occurredAtMs,
  tenantId,
  enabled = true,
}: {
  projectId: string;
  traceId: string;
  occurredAtMs: number | undefined;
  /** The member that owns the trace on an aggregate (ADR-177 block F). */
  tenantId?: string | null;
  enabled?: boolean;
}) {
  return api.codingAgents.transcript.useQuery(
    { projectId, traceId, occurredAtMs, ...(tenantId ? { tenantId } : {}) },
    { enabled },
  );
}
