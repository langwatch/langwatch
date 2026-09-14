/**
 * The protections-parameterized coding-agent transcript read.
 *
 * Extracted from the `tracesV2.*` tRPC transport (`transport/api-trpc/traces-v2.api.ts`,
 * last carried in full at `0bf461451c`) when that file's builder was removed. The behavior
 * is unchanged: the transcript is derived from the SAME span and log loads the sibling
 * `spansFull` and `traceLogs` reads use, so transcript content can never skip the
 * redaction passes those reads enforce. Both doors onto it — the tRPC procedure and the
 * REST route (`GET /api/traces/:traceId/transcript`) — hand in the `Protections` they
 * resolved for their own caller, since a project API key resolves them for the project
 * rather than for a user session.
 */

import type { Protections, SpanDetail, TraceLogRecordDto } from "@langwatch/trace-contract";
import type { CodingAgentTranscript } from "@langwatch/coding-agent-contract";

import {
  gateTraceLogVisibility,
  mapSpansToDetailDtos,
  type TraceDerivedAttrPrefixes,
  type TraceReadMapperMembers,
} from "../../transport/api-trpc/trace-read-mappers.api.ts";
import type { TraceApp } from "#app/trace.app";

/**
 * The ports this read needs that Trace does not own — the plan's visibility window, the
 * mapping/redaction implementations, and the two ingest-derived content attribute prefixes.
 *
 * Free of the metadata schema's type parameters on purpose: the transcript read never
 * touches `changeMetadata`, and threading generics through it only to discard them would
 * make the REST caller name types it does not have.
 */
export type TracesV2ReadMembers = Readonly<{
  /** The plan's visibility window for one project, or null when unbounded. */
  tryGetVisibilityCutoffMs(projectId: string): Promise<number | null>;
  /** The mapping and redaction ports the shared read mappers take. */
  mappers: TraceReadMapperMembers;
  /** The two ingest-derived content attribute prefixes. */
  derivedAttrPrefixes: TraceDerivedAttrPrefixes;
}>;

/**
 * Load one trace's spans, enriched and REDACTED.
 *
 * Extracted so `spansFull` and `codingAgentTranscript` cannot drift apart. The
 * transcript endpoint returning content that had skipped this pass would be a way
 * around the data-privacy policy the span reads enforce, so there is exactly one
 * way in.
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
  ports: TracesV2ReadMembers;
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  protections: Protections;
}): Promise<SpanDetail[]> {
  const storedSpans = await app.readSpans({
    projectId,
    traceId,
    occurredAtMs,
    visibilityCutoffMs: await ports.tryGetVisibilityCutoffMs(projectId),
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
  ports: TracesV2ReadMembers;
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
  protections: Protections;
}): Promise<TraceLogRecordDto[]> {
  const visibilityCutoffMs = await ports.tryGetVisibilityCutoffMs(projectId);
  const rows = await app.readTraceLogRecords({ projectId, traceId, occurredAtMs });
  return rows.map((row) =>
    gateTraceLogVisibility(
      {
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
      {
        logContentKeys: (eventName) =>
          app.codingAgentLogContentKeys(eventName).map((entry) => ({
            key: entry.key,
            category: entry.category,
          })),
      },
      ports.derivedAttrPrefixes,
    ),
  );
}

/** The transcript read both the `codingAgentTranscript` procedure and the REST route stand on. */
export class TraceTranscriptReadService {
  /**
   * Transcript read shared by the `codingAgentTranscript` procedure and the REST route
   * (`GET /api/traces/:traceId/transcript`). The REST caller authenticates with a project
   * API key, so it resolves `Protections` for the project rather than for a user session
   * and hands them in; both doors then run identical span and log loads, so transcript
   * content goes through the same redaction passes as every sibling read.
   */
  static async readCodingAgentTranscript({
    app,
    ports,
    projectId,
    traceId,
    occurredAtMs,
    protections,
  }: {
    app: TraceApp;
    ports: TracesV2ReadMembers;
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
