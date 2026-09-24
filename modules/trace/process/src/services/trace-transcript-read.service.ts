/**
 * Protections-parameterized coding-agent transcript read; derived from the same spans and
 * logs as other trace reads.
 */

import type { CodingAgentTranscript } from "@langwatch/coding-agent-contract";
import type { Protections, SpanDetail, TraceLogRecordDto } from "@langwatch/trace-contract";

import type { TraceApp } from "#app/trace.app";

import {
  gateTraceLogVisibility,
  mapSpansToDetailDtos,
  type TraceDerivedAttrPrefixes,
  type TraceReadMapperMembers,
} from "../transport/api-trpc/trace-read-mappers.api.ts";

/**
 * The ports this read needs that Trace does not own. Free of the metadata
 * schema's type parameters on purpose: threading generics through just to
 * discard them would force the REST caller to name types it doesn't have.
 */
export type TracesReadMembers = Readonly<{
  /** The plan's visibility window for one project; a null cutoff is an unbounded window. */
  getVisibilityWindow(projectId: string): Promise<{ visibilityCutoffMs: number | null }>;
  /** The mapping and redaction ports the shared read mappers take. */
  mappers: TraceReadMapperMembers;
  /** The two ingest-derived content attribute prefixes. */
  derivedAttrPrefixes: TraceDerivedAttrPrefixes;
}>;

/**
 * Load one trace's spans, enriched and REDACTED. Extracted so `spansFull`
 * and `codingAgentTranscript` cannot drift apart — content that skipped
 * this pass would bypass the data-privacy policy, so there's exactly one way in.
 */
async function loadSpansFullWithProtections({
  app,
  ports,
  projectId,
  traceId,
  occurredAtMs,
  protections,
}: {
  app: TraceApp;
  ports: TracesReadMembers;
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  protections: Protections;
}): Promise<SpanDetail[]> {
  const storedSpans = await app.readSpans({
    projectId,
    traceId,
    occurredAtMs,
    visibilityCutoffMs: (await ports.getVisibilityWindow(projectId)).visibilityCutoffMs,
  });
  // Claude Code's real `llm_request` spans carry tokens + `request_id` but NO
  // message content, which lives in the trace's OTLP log records. Join it on
  // BEFORE protections run, so the joined content goes through the same
  // redaction pass as any other span content rather than bypassing it.
  const spans = await app.enrichSpansFromCodingAgentLogs({
    projectId,
    traceId,
    spans: storedSpans,
    ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
  });

  return mapSpansToDetailDtos(spans, protections, ports.mappers);
}

/** Load one trace's log records, gated by the viewer's visibility exactly as `traceLogs` does. */
async function loadTraceLogsWithProtections({
  app,
  ports,
  projectId,
  traceId,
  occurredAtMs,
  protections,
}: {
  app: TraceApp;
  ports: TracesReadMembers;
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  protections: Protections;
}): Promise<TraceLogRecordDto[]> {
  const { visibilityCutoffMs } = await ports.getVisibilityWindow(projectId);
  const rows = await app.readTraceLogRecords({ projectId, traceId, occurredAtMs });
  return rows.map((row) =>
    gateTraceLogVisibility({
      row: {
        spanId: row.spanId,
        timeUnixMs: row.timeUnixMs,
        body: row.body,
        attributes: row.attributes,
        resourceAttributes: row.resourceAttributes,
        scopeName: row.scopeName,
        scopeVersion: row.scopeVersion,
      },
      protections,
      visibilityCutoffMs,
      codingAgents: {
        logContentKeys: (eventName) =>
          app.codingAgentLogContentKeys(eventName).map((entry) => ({
            key: entry.key,
            category: entry.category,
          })),
      },
      derivedAttrPrefixes: ports.derivedAttrPrefixes,
    }),
  );
}

/** The transcript read both the `codingAgentTranscript` procedure and the REST route stand on. */
export class TraceTranscriptReadService {
  private constructor() {}

  static create(): TraceTranscriptReadService {
    return new TraceTranscriptReadService();
  }

  /**
   * Transcript read shared by the `codingAgentTranscript` procedure and
   * the REST route. The REST caller authenticates with a project API key,
   * so both doors run identical span/log loads through the same redaction.
   */
  async readCodingAgentTranscript({
    app,
    ports,
    projectId,
    traceId,
    occurredAtMs,
    protections,
  }: {
    app: TraceApp;
    ports: TracesReadMembers;
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    protections: Protections;
  }): Promise<CodingAgentTranscript> {
    const args = { app, ports, projectId, traceId, occurredAtMs, protections };
    const [spans, logs] = await Promise.all([
      loadSpansFullWithProtections(args),
      loadTraceLogsWithProtections(args),
    ]);

    return app.buildCodingAgentTranscript({
      spans,
      logs,
    }) as CodingAgentTranscript;
  }
}
