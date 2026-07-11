import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/codingAgentSession.foldProjection";
import type { CodingAgentSessionRepository } from "./repositories/coding-agent-session.repository";

/**
 * Read side of the coding-agent session rollup (ADR-040).
 *
 * A point read of one pre-folded row. There is no aggregation here on purpose:
 * the fold already did it at ingest, which is the entire reason the projection
 * exists — the app, the CLI and the MCP server all want the same session facts,
 * and none of them should be re-walking 800 spans to get them.
 *
 * The row carries no prompt text, no replies and no tool output — only counters,
 * bounded sets, and the ids (`traceId`, `sessionId`, `finalRequestId`) that reach
 * the heavy data where it already lives.
 */
export class CodingAgentSessionService {
  constructor(private readonly repository: CodingAgentSessionRepository) {}

  /**
   * The session for one trace, or null when the trace is not a coding-agent
   * session (the fold writes no row for those, so a null here is the normal,
   * expected answer for an ordinary LLM trace — not an error).
   *
   * `startedAtMs` is a partition-pruning hint. Without it ClickHouse scans every
   * partition, including the cold ones on S3.
   */
  async getByTraceId({
    projectId,
    traceId,
    startedAtMs,
  }: {
    projectId: string;
    traceId: string;
    startedAtMs?: number;
  }): Promise<CodingAgentSessionRow | null> {
    return this.repository.getByTraceId({
      tenantId: projectId,
      traceId,
      startedAtMs,
    });
  }
}
