import type { Protections } from "@langwatch/trace-contract";
/**
 * TraceExportService — the download half of the trace read. It orchestrates batch fetching and CSV
 * or JSON serialization, yielding chunks progressively so the API layer streams straight to the
 * HTTP response; only one batch, up to 100 traces, is held in memory at a time.
 */

import { createLogger } from "@langwatch/observability";
import type { Evaluation, Trace } from "@langwatch/trace-contract";
import { enrichTracesWithEvaluations } from "../../rules/trace-evaluation-enrichment.rules.ts";

// The PORT rather than the concrete legacy service: the export reads one
// method, and typing it at the port lets a process hand over whatever it
// composed its legacy read as.
import type { TraceLegacyReadPort } from "../../ports/trace-legacy-read.port.ts";
import {
  CSV_NEWLINE,
  serializeTracesToFullCsv,
  serializeTracesToSummaryCsv,
} from "../../rules/trace-export-csv.rules.ts";
import {
  serializeTraceToFullJson,
  serializeTraceToSummaryJson,
} from "../../rules/trace-export-json.rules.ts";
import type { ExportProgress, ExportRequest } from "@langwatch/trace-contract";

const BATCH_SIZE = 100;

const logger = createLogger("langwatch:export");

/**
 * Domain service for exporting traces in batches: build with `create({ traceService })`, then
 * `for await (const { chunk, progress } of service.exportTraces(request))` to stream chunks to the
 * response while updating progress.
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
   * Exports traces as an async generator yielding serialized chunks with progress. Each chunk is
   * either CSV rows, the first carrying the header, or JSONL lines. Traces are fetched in batches
   * of 100 by scroll pagination, so memory stays constant whatever the total count.
   */
  async *exportTraces({
    request,
    protections,
  }: {
    request: ExportRequest;
    protections: Protections;
  }): AsyncGenerator<{ chunk: string; progress: ExportProgress }> {
    logger.info(
      { projectId: request.projectId, mode: request.mode, format: request.format },
      "Starting trace export",
    );

    let scrollId: string | undefined;
    let exported = 0;
    let total = 0;
    let isFirstBatch = true;
    // Evaluator names accumulate across batches, but for CSV the header is written from the first
    // batch's names: one appearing only later gets no column. That is inherent to streaming a CSV
    // whose header must precede the data, and evaluators are consistent across a project.
    const evaluatorNameSet = new Set<string>();

    while (true) {
      const result = await this.fetchBatch({ request, protections, scrollId });
      const traces: Trace[] = result.groups.flat();
      if (isFirstBatch) {
        total = result.totalHits;
        if (total === 0 || traces.length === 0) {
          logger.info({ projectId: request.projectId }, "No traces to export");

          return;
        }
      }

      for (const name of collectEvaluatorNames({ traces, traceChecks: result.traceChecks })) {
        evaluatorNameSet.add(name);
      }

      const enrichedTraces = enrichTracesWithEvaluations({
        traces,
        traceChecks: result.traceChecks,
      });

      exported += enrichedTraces.length;
      const chunk = serializeBatch({
        traces: enrichedTraces,
        request,
        evaluatorNames: Array.from(evaluatorNameSet).sort(),
        includeHeader: isFirstBatch,
      });

      logger.debug(
        { exported, total, batchSize: enrichedTraces.length },
        "Export batch serialized",
      );

      yield { chunk, progress: { exported, total } };

      isFirstBatch = false;
      scrollId = result.scrollId;
      if (!scrollId || traces.length === 0) {
        break;
      }
    }

    logger.info({ projectId: request.projectId, exported, total }, "Trace export completed");
  }

  /**
   * One page of the export. Blobs resolve for every mode: a summary export reads no span content
   * but still emits the trace's own input and output, so gating resolution on spans would ship
   * the truncated preview for any offloaded trace, silently. The batch resolver keeps reads
   * bounded.
   */
  private async fetchBatch({
    request,
    protections,
    scrollId,
  }: {
    request: ExportRequest;
    protections: Protections;
    scrollId: string | undefined;
  }) {
    return this.traceService.getAllTracesForProject(
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
        includeSpans: request.mode === "full",
        resolveBlobs: true,
        scrollId: scrollId ?? null,
      },
    );
  }

  /**
   * Removes the header line from a CSV string, searching for the same sequence the serializer
   * wrote: splitting on "\n" while rows end "\r\n" leaves a stray carriage return at the head of
   * the chunk. Exported for the batch-boundary tests, so a test-local copy cannot drift.
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
