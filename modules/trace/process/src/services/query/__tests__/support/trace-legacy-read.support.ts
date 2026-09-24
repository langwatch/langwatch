import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { vi } from "vitest";

import { TraceCanonicalisationService } from "#services/trace-canonicalisation.service";

import { MemoryTraceEditOverlayRepository } from "../../../../repositories/memory/memory.trace-edit-overlay.repository.ts";
import type { TraceLegacyReadRepository } from "../../../../repositories/trace-legacy-read.repository.ts";
import { TraceEditOverlayService } from "../../../trace-edit-overlay.service.ts";
import { TraceLegacyReadService } from "../../../trace-legacy-read.service.ts";

/** A real legacy read service whose project-wide page is scripted; other reads throw by name. */
export function legacyReadAnswering(
  getAllTracesForProject: TraceLegacyReadService["getAllTracesForProject"],
): TraceLegacyReadService {
  const service = TraceLegacyReadService.create({
    traceCanonicalisation: TraceCanonicalisationService.create(),
    traceRead: createApiFixture<TraceLegacyReadRepository>({}, "trace read store"),
    editOverlay: TraceEditOverlayService.create(MemoryTraceEditOverlayRepository.create()),
    evaluationService: createApiFixture<EvaluationApi>({}, "evaluations"),
  });
  vi.spyOn(service, "getAllTracesForProject").mockImplementation(getAllTracesForProject);
  return service;
}
