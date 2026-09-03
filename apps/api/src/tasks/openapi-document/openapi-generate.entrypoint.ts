import process from "node:process";
import { resolve } from "node:path";

import { DEFAULT_SCRATCH_PATH, generateOpenApiDocument } from "./openapi-document.generator";

/**
 * The runnable OpenAPI description —
 * `pnpm --filter @langwatch/platform-api task:openapi-generate [path]`.
 *
 * It writes to the path the caller names, and to a scratch file under
 * `node_modules/.cache` when the caller names none. It NEVER writes
 * `src/features/discovery/openapi-document.json`: that artifact is frozen, three
 * routes serve it and both SDKs generate clients from it, so replacing it is a
 * decision a person makes with a diff in front of them, not a side effect of
 * running a task.
 *
 * Where it wrote and what it found are printed, because the useful output of
 * this command is not the file — it is the sentence saying how much of the
 * published surface the process can still describe.
 */
const outputPath = resolve(process.argv[2] ?? DEFAULT_SCRATCH_PATH);

void generateOpenApiDocument({ outputPath })
  .then((generated) => {
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
  })
  .catch((error: unknown) => {
    process.stderr.write(`OpenAPI generation failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
