import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { MemoryTraceEditOverlayRepository } from "../../../../repositories/memory/memory.trace-edit-overlay.repository.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import type { TraceLegacyReadRepository } from "../../../../features/legacy/repositories/trace-legacy-read.repository.ts";
import { TraceEditOverlayService } from "../../../../features/edit-overlay/services/trace-edit-overlay.service.ts";
import { TraceLegacyReadService } from "../../../../features/legacy/services/trace-legacy-read.service.ts";

/** A real legacy read service whose project-wide page is scripted; other reads throw by name. */
export function legacyReadAnswering(
  getAllTracesForProject: TraceLegacyReadService["getAllTracesForProject"],
): TraceLegacyReadService {
  const service = TraceLegacyReadService.create({
    traceCanonicalisation: TraceCanonicalisationService.create(),
    traceRead: createApiFixture<TraceLegacyReadRepository>({}, "trace read store"),
    editOverlay: TraceEditOverlayService.create(MemoryTraceEditOverlayRepository.create()),
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
  });
  vi.spyOn(service, "getAllTracesForProject").mockImplementation(getAllTracesForProject);
  return service;
}
