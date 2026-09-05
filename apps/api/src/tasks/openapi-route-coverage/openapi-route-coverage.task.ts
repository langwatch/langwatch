import { resolve } from "node:path";
import { Task } from "@langwatch/task";
import {
  auditCoverage,
  coverageFailed,
  renderCoverageReport,
} from "./openapi-route-coverage.auditor";
import { UNPUBLISHED } from "./openapi-route-coverage.exclusions";
import { readCoverageSurface } from "./openapi-route-coverage.surface";

/**
 * Where the description this audit reads is written when the caller names no
 * path. A build cache, deliberately: the frozen document is never a target.
 */
export const DEFAULT_COVERAGE_SCRATCH_PATH =
  "node_modules/.cache/openapi/route-coverage-document.json";

/**
 * The runnable route-coverage gate — `pnpm --filter @langwatch/platform-api
 * task openapi-route-coverage [scratch]`. It walks this process's own mounts.
 */

// Exits non-zero on three conditions: a mounted route with no operation and no
// written reason, a documented operation no route answers, and an UNPUBLISHED
// entry that excuses nothing. The third is the ratchet — without it the list
// outlives the routes it was written for and the gate goes quiet.
export class OpenapiRouteCoverageTask extends Task {
  readonly name = "openapi-route-coverage";
  readonly description =
    "Fails when a mounted REST route reaches no OpenAPI operation and no written reason explains it.";

  static create(): OpenapiRouteCoverageTask {
    return new OpenapiRouteCoverageTask();
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const scratchPath = resolve(args[0] ?? DEFAULT_COVERAGE_SCRATCH_PATH);
    const surface = await readCoverageSurface({ scratchPath });

    const result = auditCoverage({
      routes: surface.routes,
      documented: surface.documented,
      exclusions: UNPUBLISHED,
    });
    process.stdout.write(`${renderCoverageReport({ result, exclusions: UNPUBLISHED })}\n`);

    if (!coverageFailed(result)) return;
    // A plain Error, deliberately: this never crosses an API boundary to a
    // customer, and the report above already says what to do about it.
    throw new Error("The REST surface and the OpenAPI document disagree; see the report above.");
  }
}
