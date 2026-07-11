import type { SpanDetail } from "~/server/api/routers/tracesV2.schemas";
import {
  buildCodingAgentTranscript,
  type CodingAgentTranscript,
  type TranscriptLogRecord,
} from "./coding-agent-transcript.derivation";

/**
 * The coding-agent transcript, assembled server-side.
 *
 * This used to be three modules in the browser. It moved here because a
 * transcript is not a rendering concern: the CLI wants it, an MCP server wants
 * it, and an export wants it, and none of them will run React to get one. The
 * view now asks for a transcript instead of building one, so there is exactly
 * one implementation to keep correct.
 *
 * The derivation is pure and lives next door; this is only the IO around it.
 */
export class CodingAgentTranscriptService {
  constructor(
    private readonly deps: {
      getSpans: (params: {
        tenantId: string;
        traceId: string;
        occurredAtMs?: number;
      }) => Promise<SpanDetail[]>;
      getLogs: (params: {
        tenantId: string;
        traceId: string;
        occurredAtMs?: number;
      }) => Promise<TranscriptLogRecord[]>;
    },
  ) {}

  /**
   * One trace's transcript.
   *
   * Reads spans AND logs, because neither alone is the session: the spans have
   * no record of a tool the human DENIED (it never ran), and the logs have no
   * record of how long anything took.
   */
  async getByTraceId({
    projectId,
    traceId,
    occurredAtMs,
  }: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<CodingAgentTranscript> {
    const [spans, logs] = await Promise.all([
      this.deps.getSpans({ tenantId: projectId, traceId, occurredAtMs }),
      this.deps.getLogs({ tenantId: projectId, traceId, occurredAtMs }),
    ]);

    return buildCodingAgentTranscript({ spans, logs });
  }
}
