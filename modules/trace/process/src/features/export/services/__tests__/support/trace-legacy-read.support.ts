import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { explorerHiddenOrigins, type ExportRequest } from "@langwatch/trace-contract";
import { vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { MemoryTraceEditOverlayRepository } from "../../../../../repositories/memory/memory.trace-edit-overlay.repository.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../../../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { explorerOriginExclusion } from "../../../../../rules/trace-filter-hidden-origins.rules.ts";
import { TraceEditOverlayService } from "../../../../edit-overlay/services/trace-edit-overlay.service.ts";
import type { TraceLegacyReadRepository } from "../../../../legacy/repositories/trace-legacy-read.repository.ts";
import type { LegacyTraceMappingService } from "../../../../legacy/services/legacy-trace-mapping.service.ts";
import { TraceLegacyReadService } from "../../../../legacy/services/trace-legacy-read.service.ts";

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
export function hiddenOriginsOnly({ request }: { request: ExportRequest }) {
  return explorerOriginExclusion({ hiddenOrigins: explorerHiddenOrigins(request.query) })(
    undefined,
  );
}
