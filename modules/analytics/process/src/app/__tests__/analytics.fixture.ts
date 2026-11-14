import type { LangWatchQLCatalogueAccess } from "@langwatch/analytics-contract";

import { cataloguePermissions } from "../../rules/lwql-catalogue.rules.ts";
import { LWQL_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import { LangWatchQLAccessRefusalService } from "../../services/langwatch-ql-access-refusal.service.ts";
import { LangWatchQLRunTelemetryService } from "../../services/langwatch-ql-run-telemetry.service.ts";
import {
  LangWatchQLService,
  type LangWatchQLServiceDependencies,
} from "../../services/langwatch-ql.service.ts";

/** A caller reading every catalogue table and column, for a suite that runs the real policy. */
export const EVERY_CATALOGUE_PERMISSION: LangWatchQLCatalogueAccess = {
  permissions: cataloguePermissions({ catalog: LWQL_CATALOG }),
};

/** Run telemetry for a suite that builds the LangWatchQL service alone, its hash key fixed. */
export const TEST_RUN_TELEMETRY = LangWatchQLRunTelemetryService.create({
  queryHashKey: new Uint8Array(32).fill(7),
});

/** The refusal ledger for a suite that builds the LangWatchQL service alone. */
export const TEST_ACCESS_REFUSALS = LangWatchQLAccessRefusalService.create();

/** A placement gate that admits every run, for a suite that measures what happens past it. */
export const ADMIT_EVERY_PLACEMENT: LangWatchQLServiceDependencies["placement"] = {
  admit: () => Promise.resolve(),
};

/**
 * The real LangWatchQL service, for a suite that measures a real refusal —
 * built here so a consuming test never names the private service class.
 */
export function createLangWatchQLService(
  dependencies: Omit<
    LangWatchQLServiceDependencies,
    "runTelemetry" | "accessRefusals" | "placement"
  > &
    Partial<Pick<LangWatchQLServiceDependencies, "accessRefusals" | "placement">>,
): LangWatchQLService {
  return LangWatchQLService.create({
    runTelemetry: TEST_RUN_TELEMETRY,
    accessRefusals: TEST_ACCESS_REFUSALS,
    placement: ADMIT_EVERY_PLACEMENT,
    ...dependencies,
  });
}

/**
 * The shared LangWatchQL executor fake for every suite that only needs to observe what reached
 * this seam, not what a real database does with it.
 */
import {
  type LangWatchQLExecutionRequest,
  type LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../../repositories/langwatch-ql-executor.repository.ts";

export class RecordingLangWatchQLExecutor extends LangWatchQLExecutorRepository {
  readonly calls: LangWatchQLExecutionRequest[] = [];

  constructor(private readonly result: Partial<LangWatchQLExecutionResult> = {}) {
    super();
  }

  execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult> {
    this.calls.push(request);

    return Promise.resolve({
      columns: [{ name: "value", type: "UInt64" }],
      rows: [{ value: 1 }],
      statistics: {
        elapsedMs: 3,
        rowsRead: 10,
        bytesRead: 100,
        rowsReturned: 1,
      },
      ...this.result,
    });
  }
}

export function recordingExecutor(
  result: Partial<LangWatchQLExecutionResult> = {},
): RecordingLangWatchQLExecutor {
  return new RecordingLangWatchQLExecutor(result);
}
