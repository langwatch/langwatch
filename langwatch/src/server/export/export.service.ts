/**
 * ExportService — domain layer for trace export functionality.
 *
 * Orchestrates batch fetching of traces via TraceService and serialization
 * via CSV/JSON serializers. Yields chunks progressively through an
 * AsyncGenerator, enabling the API layer to stream directly to an HTTP response.
 *
 * Memory-efficient: only one batch of traces (up to 100) is held in memory at a time.
 */

import type { PrismaClient } from "@prisma/client";
import type { Protections } from "~/server/elasticsearch/protections";
import type { Trace, Evaluation } from "~/server/tracer/types";
import { enrichTracesWithEvaluations } from "~/server/traces/enrich-evaluations";
import type { TraceService } from "~/server/traces/trace.service";
import { createLogger } from "~/utils/logger/server";
import {
  serializeTracesToSummaryCsv,
  serializeTracesToFullCsv,
} from "./serializers/csv-serializer";
import {
  serializeTraceToSummaryJson,
  serializeTraceToFullJson,
} from "./serializers/json-serializer";
import type { ExportProgress, ExportRequest } from "./types";

const BATCH_SIZE = 100;

const logger = createLogger("langwatch:export");

/**
 * Domain service for exporting traces in batches.
 *
 * @example
 * ```ts
 * const service = ExportService.create(prisma);
 * for await (const { chunk, progress } of service.exportTraces(request)) {
 *   response.write(chunk);
 *   updateProgress(progress);
 * }
 * ```
 */
export class ExportService {
  private readonly traceService: TraceService;

  constructor({ traceService }: { traceService: TraceService }) {
    this.traceService = traceService;
  }

  /**
   * Factory method for creating ExportService with default dependencies.
   *
   * Lazily imports TraceService and Prisma to avoid module-level side effects
   * that would break unit tests which only inject mocks.
   */
  static async create(prisma?: PrismaClient): Promise<ExportService> {
    const { TraceService: TraceServiceImpl } = await import(
      "~/server/traces/trace.service"
    );
    const resolvedPrisma =
      prisma ?? (await import("~/server/db")).prisma;
    const traceService = TraceServiceImpl.create(resolvedPrisma);
    return new ExportService({ traceService });
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
   * Export traces as an async generator yielding serialized chunks with progress.
   *
   * Each yielded chunk is a string containing either:
   * - CSV rows (first chunk includes header; subsequent chunks are data-only)
   * - JSONL lines (one JSON object per line)
   *
   * The generator fetches traces in batches of 100 using scroll pagination
   * to maintain constant memory usage regardless of total trace count.
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
      for (const name of batchNames) evaluatorNameSet.add(name);

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

    logger.info(
      { projectId: request.projectId, exported, total },
      "Trace export completed",
    );
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
      return serializeCsvBatch({ traces, request, evaluatorNames, includeHeader });
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
      return includeHeader ? fullCsv : stripCsvHeader(fullCsv);
    }
    case "full": {
      const fullCsv = serializeTracesToFullCsv({ traces, evaluatorNames });
      return includeHeader ? fullCsv : stripCsvHeader(fullCsv);
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
      return traces
        .map((trace) => serializeTraceToSummaryJson({ trace }))
        .join("\n") + "\n";
    case "full":
      return traces
        .map((trace) => serializeTraceToFullJson({ trace }))
        .join("\n") + "\n";
    default: {
      const _exhaustive: never = request.mode;
      throw new Error(`Unsupported mode: ${_exhaustive}`);
    }
  }
}

/**
 * Remove the first line (header) from a CSV string.
 */
function stripCsvHeader(csv: string): string {
  const firstNewline = csv.indexOf("\n");
  if (firstNewline === -1) return "";
  return csv.slice(firstNewline + 1);
}
