import { resolve } from "node:path";

import { serverModules } from "@langwatch/installed-modules/server";
import { Task } from "@langwatch/task";

import { declaredRestFamilies, type InstalledModule } from "./openapi-document.declarations.ts";
import { DEFAULT_SCRATCH_PATH, generateOpenApiDocument } from "./openapi-document.generator.ts";

/**
 * The runnable OpenAPI description — `pnpm --filter @langwatch/platform-api
 * task openapi-generate [path]`.
 *
 * It writes to the path the caller names, and to a scratch file under
 * `node_modules/.cache` when the caller names none. It NEVER writes
 * `src/features/discovery/openapi-document.json`: that artifact is frozen, three
 * routes serve it and both SDKs generate clients from it, so replacing it is a
 * decision a person makes with a diff in front of them, not a side effect of
 * running a task.
 *
 * Stays in `apps/api` because this is the process that serves the document.
 * It reads the installed module declarations and nothing else: no database, no
 * ClickHouse, no member of any kind.
 */
export class OpenapiGenerateTask extends Task {
  readonly name = "openapi-generate";
  readonly description = "Writes the OpenAPI description every installed declaration publishes.";

  static create(): OpenapiGenerateTask {
    return new OpenapiGenerateTask();
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const outputPath = resolve(args[0] ?? DEFAULT_SCRATCH_PATH);
    const generated = await generateOpenApiDocument({
      outputPath,
      families: declaredRestFamilies(serverModules as readonly InstalledModule[]),
    });

    process.stdout.write(
      [
        `Read ${generated.counts.routes} declared routes from ${generated.counts.families} families`,
        `Wrote ${generated.operations.length} operations to ${generated.outputPath}`,
        ...(generated.unpublishable.length > 0
          ? [
              "",
              "Declared, and left out because no security scheme can express the credential:",
              ...generated.unpublishable.map(
                ({ operation, family }) => `  ! ${operation} (${family})`,
              ),
            ]
          : []),
        ...(generated.undescribed.length > 0
          ? [
              "",
              "Declared, and kept out of the document by the declaration itself:",
              ...generated.undescribed.map(
                ({ operation, family, because }) => `  ? ${operation} (${family}): ${because}`,
              ),
            ]
          : []),
        "",
      ].join("\n"),
    );
  }
}
