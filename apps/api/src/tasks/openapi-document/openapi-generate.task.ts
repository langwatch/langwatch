import { resolve } from "node:path";
import { Task } from "@langwatch/task";
import { DEFAULT_SCRATCH_PATH, generateOpenApiDocument } from "./openapi-document.generator";

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
 * Stays in `apps/api` rather than moving to `apps/tasks`: {@link
 * generateOpenApiDocument} walks `apps/api/src/app-rest`'s own registered
 * routes, so it needs this process's full REST boot graph, not a database or
 * ClickHouse connection — the thing `apps/tasks` composes instead.
 */
export class OpenapiGenerateTask extends Task {
  readonly name = "openapi-generate";
  readonly description = "Writes the OpenAPI description of every route this process serves.";

  static create(): OpenapiGenerateTask {
    return new OpenapiGenerateTask();
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const outputPath = resolve(args[0] ?? DEFAULT_SCRATCH_PATH);
    const generated = await generateOpenApiDocument({ outputPath });

    process.stdout.write(
      [
        `Wrote ${generated.operations.length} operations to ${generated.outputPath}`,
        ...(generated.unpublishable.length > 0
          ? [
              "",
              "Served, and left out because no security scheme can express the credential:",
              ...generated.unpublishable.map(({ operation }) => `  ! ${operation}`),
            ]
          : []),
        ...(generated.absences.length > 0
          ? [
              "",
              "Families this description could not cover:",
              ...generated.absences.map(({ family, because }) => `  ? ${family}: ${because}`),
            ]
          : []),
        "",
      ].join("\n"),
    );
  }
}
