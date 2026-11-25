/**
 * @vitest-environment node
 * @see specs/trace-processing/worker-trace-projection-runtime.feature
 * The worker's own source tree, read as text: which of its files name the trace process module.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const WORKER_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(file);
    return entry.name.endsWith(".ts") ? [file] : [];
  });
}

describe("given the worker's own source tree", () => {
  describe("when every module that names the trace process module is listed", () => {
    /** @scenario "the converted pipeline is mounted by the production composition" */
    it("finds the generated process-module list as the only caller outside the tests", () => {
      const callers = sourceFiles(WORKER_SOURCE)
        .filter((file) => /\btraceProcessModule\b/.test(readFileSync(file, "utf8")))
        .map((file) => path.relative(WORKER_SOURCE, file));

      expect(callers).toEqual(["process-modules.generated.ts"]);
    });

    it("hands that list to the composition the entrypoint boots", () => {
      const main = readFileSync(path.join(WORKER_SOURCE, "main.ts"), "utf8");

      expect(main).toContain('import { processModules } from "./process-modules.generated.ts"');
      expect(main).toContain('processConfig(processModules, "worker")');
    });
  });
});
