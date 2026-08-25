/** Private persistence port for the trace-to-session projection. */
export abstract class CodingAgentTraceSessionRepository {
  abstract findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<{ sessionId: string; occurredAtMs: number } | null>;
}
