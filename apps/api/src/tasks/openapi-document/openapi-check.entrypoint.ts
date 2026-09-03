import process from "node:process";
import { resolve } from "node:path";

import { checkOpenApiDocument, renderDriftReport } from "./openapi-document.checker";
import { DEFAULT_SCRATCH_PATH } from "./openapi-document.generator";

/**
 * The runnable OpenAPI drift check —
 * `pnpm --filter @langwatch/platform-api task:openapi-check [scratch] [frozen]`.
 *
 * Exit 1 on ONE condition: the frozen document lists an operation this process
 * serves no route for, and that operation is not in the checker's recorded
 * baseline. That is the breaking direction — an integrator generated a client
 * from the document and the call now 404s.
 *
 * Everything else prints and exits 0. Operations served but undocumented
 * cannot fail the run while the document is frozen: every route added since
 * the freeze is one of them, and failing on those would make the check a wall
 * rather than a signal.
 */
const scratchPath = resolve(process.argv[2] ?? DEFAULT_SCRATCH_PATH);
/**
 * The document to compare against. The frozen artifact unless a caller names
 * another — useful for checking a release's published document, and the reason
 * the failing path can be exercised from a shell without touching the frozen
 * file. It is READ, never written, whichever it is.
 */
const frozenPath = process.argv[3] ? resolve(process.argv[3]) : undefined;

void checkOpenApiDocument({ scratchPath, ...(frozenPath ? { frozenPath } : {}) })
  .then((report) => {
    process.stdout.write(`${renderDriftReport(report)}\n`);
    if (report.regressions.length === 0) return;
    process.stderr.write(
      `\n${report.regressions.length} documented operation(s) are no longer served. ` +
        "Mount the family again, or drop the operation from the document deliberately.\n",
    );
    process.exitCode = 1;
  })
  .catch((error: unknown) => {
    process.stderr.write(`OpenAPI check failed: ${String(error)}\n`);
    process.exitCode = 1;
  });
