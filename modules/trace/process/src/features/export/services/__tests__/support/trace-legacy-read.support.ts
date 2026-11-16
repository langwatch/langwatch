import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { explorerHiddenOrigins, type ExportRequest } from "@langwatch/trace-contract";
import { vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { traceSummaries } from "../../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import { MemoryTraceEditOverlayRepository } from "../../../../../repositories/memory/memory.trace-edit-overlay.repository.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../../../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { TraceEditOverlayService } from "../../../../edit-overlay/services/trace-edit-overlay.service.ts";
import type { TraceLegacyReadRepository } from "../../../../legacy/repositories/trace-legacy-read.repository.ts";
import type { LegacyTraceMappingService } from "../../../../legacy/services/legacy-trace-mapping.service.ts";
import { TraceLegacyReadService } from "../../../../legacy/services/trace-legacy-read.service.ts";
import {
  andTraceFilterTerms,
  findHiddenOriginFilters,
  type TraceFilterCompile,
} from "../../../../query/repositories/clickhouse/clickhouse.trace-filter-condition.mapper.ts";

/** A real legacy read service whose project-wide page is scripted; other reads throw by name. */
export function legacyReadAnswering(
  getAllTracesForProject: TraceLegacyReadService["getAllTracesForProject"],
): TraceLegacyReadService {
  const service = TraceLegacyReadService.create({
    traceCanonicalisation: TraceCanonicalisationService.create(),
    traceRead: createApiFixture<TraceLegacyReadRepository>({}, "trace read store"),
    mapping: createApiFixture<LegacyTraceMappingService>({}, "legacy trace mapping"),
    editOverlay: TraceEditOverlayService.create(MemoryTraceEditOverlayRepository.create()),
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
  });
  vi.spyOn(service, "getAllTracesForProject").mockImplementation(getAllTracesForProject);
  return service;
}

/** The Explorer's origin rule alone, standing in for the app's full query compiler. */
export function hiddenOriginsOnly({
  request,
}: {
  request: ExportRequest;
}): TraceFilterCompile | undefined {
  const terms = findHiddenOriginFilters({ hiddenOrigins: explorerHiddenOrigins(request.query) });
  if (terms.length === 0) return undefined;
  return () => andTraceFilterTerms({ compilation: { kind: "empty" }, terms });
}

/** A compiled filter rendered into the count read it narrows, as the store builds it. */
export function renderedFilter({
  compile,
  tenantId,
}: {
  compile: TraceFilterCompile | undefined;
  tenantId: string;
}) {
  const scope = tenantScope.single({ tenantId });
  const compiled = compile?.({ scope });
  if (compiled?.kind !== "compiled") return undefined;
  return clickhouseRead({ scope })
    .from(traceSummaries)
    .select({ total: fn.count() })
    .where((ops) => compiled.where(ops))
    .build();
}
