import { resolve } from "node:path";

import { serverModules } from "@langwatch/installed-modules/server";
import { Task } from "@langwatch/task";

import { checkOpenApiDocument, renderDriftReport } from "./openapi-document.checker.ts";
import {
  declaredRestFamilies,
  type InstalledModule,
} from "./openapi-document.declarations.ts";
import { DEFAULT_SCRATCH_PATH } from "./openapi-document.generator.ts";

/**
 * The runnable OpenAPI drift check — `pnpm --filter @langwatch/platform-api
 * task openapi-check [scratch] [frozen]`.
 *
 * Exit non-zero on ONE condition: the frozen document lists an operation no
 * installed declaration publishes, and that operation is not in the checker's
 * recorded baseline. That is the breaking direction — an integrator generated
 * a client from the document and the call now 404s.
 *
 * Everything else prints and exits 0. Operations declared but undocumented
 * cannot fail the run while the document is frozen: every route added since
 * the freeze is one of them, and failing on those would make the check a wall
 * rather than a signal.
 */
export class OpenapiCheckTask extends Task {
  readonly name = "openapi-check";
  readonly description =
    "Fails when the frozen OpenAPI document lists a route no declaration publishes.";

  static create(): OpenapiCheckTask {
    return new OpenapiCheckTask();
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const scratchPath = resolve(args[0] ?? DEFAULT_SCRATCH_PATH);
    const frozenPath = args[1] ? resolve(args[1]) : undefined;

    const report = await checkOpenApiDocument({
      scratchPath,
      families: declaredRestFamilies(serverModules as readonly InstalledModule[]),
      ...(frozenPath ? { frozenPath } : {}),
    });
    process.stdout.write(`${renderDriftReport(report)}\n`);

    if (report.regressions.length === 0) return;

    // A plain Error, deliberately: this never crosses an API boundary to a
    // customer, so it needs no registered code — it is a build signal an
    // operator reads off the process's own exit status and stderr.
    throw new Error(
      `${report.regressions.length} documented operation(s) are published by no declaration. ` +
        "Install the module again, or drop the operation from the document deliberately.",
    );
  }
}
