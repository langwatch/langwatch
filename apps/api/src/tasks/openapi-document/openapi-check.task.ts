import { resolve } from "node:path";

import { serverModules } from "@langwatch/installed-modules/server";
import { Task } from "@langwatch/task";

import { checkOpenApiDocument, renderDriftReport } from "./openapi-document.checker.ts";
import { declaredRestFamilies, type InstalledModule } from "./openapi-document.declarations.ts";
import { DEFAULT_SCRATCH_PATH } from "./openapi-document.generator.ts";

// Runnable OpenAPI drift check. Fails when frozen document lists missing
// operations.
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
