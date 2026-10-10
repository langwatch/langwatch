import { LegacyTraceMappingService } from "../../../../services/legacy-trace-mapping.service.ts";
import {
  TraceLegacyReadClickHouseRepository,
  type ClickHouseTraceLegacyReadOptions,
} from "../../trace-legacy-read.repository.ts";

type MappingInputs = Omit<Parameters<typeof LegacyTraceMappingService.create>[0], "repository">;

/** The ClickHouse store with the mapping service over it, as the app composes the legacy read. */
export function mappedLegacyRead({
  traceCanonicalisation,
  resolveTraceSpans,
  resolveTraceSpansBatch,
  retentionDays,
  ...store
}: MappingInputs & ClickHouseTraceLegacyReadOptions): LegacyTraceMappingService {
  return LegacyTraceMappingService.create({
    repository: TraceLegacyReadClickHouseRepository.create(store),
    traceCanonicalisation,
    resolveTraceSpans,
    resolveTraceSpansBatch,
    retentionDays,
  });
}
