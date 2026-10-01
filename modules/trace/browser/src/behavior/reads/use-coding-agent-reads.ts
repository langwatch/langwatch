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
  enabled = true,
}: {
  projectId: string;
  traceId: string;
  occurredAtMs: number | undefined;
  enabled?: boolean;
}) {
  return api.codingAgents.transcript.useQuery({ projectId, traceId, occurredAtMs }, { enabled });
}
