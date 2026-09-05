import type { Protections } from "@langwatch/trace-contract";
/**
 * TraceExportService — the download half of the trace read. Orchestrates batch fetching via TraceService and serialization via CSV/JSON serializers, yielding chunks progressively through an AsyncGenerator so the API layer streams directly to the HTTP response; only one batch (up to 100 traces) is held in memory at a time.
 */

import { createLogger } from "@langwatch/observability";
import type { Evaluation, Trace } from "@langwatch/trace-contract";
import { enrichTracesWithEvaluations } from "../rules/trace-evaluation-enrichment.rules";

// The PORT rather than the concrete legacy service: the export reads one
// method, and typing it at the port lets a process hand over whatever it
// composed its legacy read as.
import type { TraceLegacyReadPort } from "../ports/trace-legacy-read.port";
import {
  CSV_NEWLINE,
  serializeTracesToFullCsv,
  serializeTracesToSummaryCsv,
} from "../rules/trace-export-csv.rules";
import {
  serializeTraceToFullJson,
  serializeTraceToSummaryJson,
} from "../rules/trace-export-json.rules";
import type { ExportProgress, ExportRequest } from "@langwatch/trace-contract";

const BATCH_SIZE = 100;

const logger = createLogger("langwatch:export");

/**
 * Domain service for exporting traces in batches: `TraceExportService.create({ traceService })`, then `for await (const { chunk, progress } of service.exportTraces(request))` to stream chunks to the response while updating progress.
 */
export class TraceExportService {
  private readonly traceService: TraceLegacyReadPort;

  private constructor({ traceService }: { traceService: TraceLegacyReadPort }) {
    this.traceService = traceService;
  }

  /** Creates the process-owned export facade over the composed trace reader. */
  static create({ traceService }: { traceService: TraceLegacyReadPort }): TraceExportService {
    return new TraceExportService({ traceService });
  }

  /**
   * Get the total count of traces matching the export request.
   * Used to send X-Total-Traces header before streaming starts.
   */
  async getTotalCount({
    request,
    protections,
  }: {
    request: ExportRequest;
    protections: Protections;
  }): Promise<number> {
    const result = await this.traceService.getAllTracesForProject(
      {
        projectId: request.projectId,
        startDate: request.startDate,
        endDate: request.endDate,
        filters: request.filters,
        query: request.query,
        traceIds: request.traceIds,
        pageSize: 1,
      },
      protections,
      {
        downloadMode: false,
        includeSpans: false,
        scrollId: null,
      },
    );

    return result.totalHits;
  }

  /**
   * Export traces as an async generator yielding serialized chunks with progress. Each chunk is either CSV rows (first chunk includes header; later chunks are data-only) or JSONL lines. Fetches traces in batches of 100 via scroll pagination to keep memory usage constant regardless of total trace count.
   */
  async *exportTraces({
    request,
    protections,
  }: {
    request: ExportRequest;
    protections: Protections;
  }): AsyncGenerator<{ chunk: string; progress: ExportProgress }> {
    logger.info(
      {
        projectId: request.projectId,
        mode: request.mode,
        format: request.format,
      },
      "Starting trace export",
    );

    const includeSpans = request.mode === "full";
    let scrollId: string | undefined;
    let exported = 0;
    let total = 0;
    let isFirstBatch = true;
    // Accumulate evaluator names across all batches.
    // NOTE: For CSV, the header is written from batch 1's evaluator names. Evaluators
    // appearing only in later batches will not have columns in the header. This is a
    // known limitation of streaming CSV where the header must be emitted before all
    // data is known. In practice, evaluators are consistent across a project's traces.
    const evaluatorNameSet = new Set<string>();

    // Fetch batches until no more data
    while (true) {
      const result = await this.traceService.getAllTracesForProject(
        {
          projectId: request.projectId,
          startDate: request.startDate,
          endDate: request.endDate,
          filters: request.filters,
          query: request.query,
          traceIds: request.traceIds,
          pageSize: BATCH_SIZE,
          scrollId,
        },
        protections,
        {
          downloadMode: true,
          includeSpans,
          // DATA LOSS (#4991): summary mode reads no span content, but it still emits
          // trace-level `trace.input`/`trace.output` (csv/json summary serializers), so it
          // is content-consuming too — gating on `includeSpans` shipped the truncated 64 KB
          // preview for any offloaded trace, silently. Resolve for every export mode; the
          // batch resolver keeps the extra event_log reads bounded.
          resolveBlobs: true,
          scrollId: scrollId ?? null,
        },
      );

      // Flatten groups into traces
      const traces: Trace[] = result.groups.flat();

      // On first batch, capture total
      if (isFirstBatch) {
        total = result.totalHits;

        if (total === 0 || traces.length === 0) {
          logger.info({ projectId: request.projectId }, "No traces to export");

          return;
        }
      }

      // Merge evaluator names from every batch
      const batchNames = collectEvaluatorNames({
        traces,
        traceChecks: result.traceChecks,
      });
      for (const name of batchNames) {
        evaluatorNameSet.add(name);
      }

      // Merge evaluations from traceChecks into trace objects
      const enrichedTraces = enrichTracesWithEvaluations({
        traces,
        traceChecks: result.traceChecks,
      });

      exported += enrichedTraces.length;
      const progress: ExportProgress = { exported, total };

      const evaluatorNames = Array.from(evaluatorNameSet).sort();
      const chunk = serializeBatch({
        traces: enrichedTraces,
        request,
        evaluatorNames,
        includeHeader: isFirstBatch,
      });

      logger.debug(
        { exported, total, batchSize: enrichedTraces.length },
        "Export batch serialized",
      );

      yield { chunk, progress };

      isFirstBatch = false;
      scrollId = result.scrollId;

      // Stop if no more data (no scrollId or empty batch)
      if (!scrollId || traces.length === 0) {
        break;
      }
    }

    logger.info({ projectId: request.projectId, exported, total }, "Trace export completed");
  }

  /**
   * Remove the first line (header) from a CSV string. Must search for the same sequence the serializer wrote — splitting on "\n" while rows are terminated with "\r\n" leaves a stray carriage return at the head of the chunk (a phantom leading field). Exported for the batch-boundary tests, which concatenate chunks exactly as this service does; a test-local copy could pass while this regressed.
   */
  static stripCsvHeader(csv: string): string {
    const firstBreak = csv.indexOf(CSV_NEWLINE);
    if (firstBreak === -1) {
      return "";
    }

    return csv.slice(firstBreak + CSV_NEWLINE.length);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Collect unique evaluator names from traces and traceChecks.
 */
function collectEvaluatorNames({
  traces,
  traceChecks,
}: {
  traces: Trace[];
  traceChecks: Record<string, Evaluation[]>;
}): string[] {
  const names = new Set<string>();

  for (const trace of traces) {
    for (const evaluation of trace.evaluations ?? []) {
      names.add(evaluation.name);
    }
  }

  for (const checks of Object.values(traceChecks)) {
    for (const check of checks) {
      if (check.name) {
        names.add(check.name);
      }
    }
  }

  return Array.from(names).sort();
}

/**
 * Serialize a batch of traces according to the requested mode and format.
 */
function serializeBatch({
  traces,
  request,
  evaluatorNames,
  includeHeader,
}: {
  traces: Trace[];
  request: ExportRequest;
  evaluatorNames: string[];
  includeHeader: boolean;
}): string {
  switch (request.format) {
    case "csv":
      return serializeCsvBatch({
        traces,
        request,
        evaluatorNames,
        includeHeader,
      });
    case "json":
      return serializeJsonBatch({ traces, request });
    default: {
      const _exhaustive: never = request.format;

      throw new Error(`Unsupported format: ${_exhaustive}`);
    }
  }
}

function serializeCsvBatch({
  traces,
  request,
  evaluatorNames,
  includeHeader,
}: {
  traces: Trace[];
  request: ExportRequest;
  evaluatorNames: string[];
  includeHeader: boolean;
}): string {
  switch (request.mode) {
    case "summary": {
      const fullCsv = serializeTracesToSummaryCsv({ traces, evaluatorNames });

      return includeHeader ? fullCsv : TraceExportService.stripCsvHeader(fullCsv);
    }
    case "full": {
      const fullCsv = serializeTracesToFullCsv({ traces, evaluatorNames });

      return includeHeader ? fullCsv : TraceExportService.stripCsvHeader(fullCsv);
    }
    default: {
      const _exhaustive: never = request.mode;

      throw new Error(`Unsupported mode: ${_exhaustive}`);
    }
  }
}

function serializeJsonBatch({
  traces,
  request,
}: {
  traces: Trace[];
  request: ExportRequest;
}): string {
  switch (request.mode) {
    case "summary":
      return traces.map((trace) => serializeTraceToSummaryJson({ trace })).join("\n") + "\n";
    case "full":
      return traces.map((trace) => serializeTraceToFullJson({ trace })).join("\n") + "\n";
    default: {
      const _exhaustive: never = request.mode;

      throw new Error(`Unsupported mode: ${_exhaustive}`);
    }
  }
}
