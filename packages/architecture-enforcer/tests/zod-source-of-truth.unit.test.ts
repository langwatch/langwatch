/**
 * Zod schemas are written, not generated. The prepare step used to run
 * ts-to-zod over the tracer, dataset and experiment types, which printed
 * "File not found" warnings and quietly widened shapes to `z.any()`.
 *
 * @see specs/dependencies/zod-first-schema-source-of-truth.feature
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "../../..");

describe("given Zod schemas are the single source of truth", () => {
  describe("when the build preparation is configured", () => {
    /** @scenario Starting the server does not run a type-to-schema generator */
    it("declares no ts-to-zod step, dependency, config or generated schema file", () => {
      const rootPackage = JSON.parse(
        readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
      ) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };

      expect(rootPackage.scripts?.["start:prepare:files"] ?? "").not.toContain("zod:generate");
      expect(rootPackage.scripts?.["types:zod:generate"]).toBeUndefined();
      expect(rootPackage.devDependencies?.["ts-to-zod"]).toBeUndefined();
      expect(rootPackage.dependencies?.["ts-to-zod"]).toBeUndefined();
      expect(existsSync(path.join(REPO_ROOT, "ts-to-zod.config.js"))).toBe(false);
      expect(existsSync(path.join(REPO_ROOT, "scripts/generate-zod-types.sh"))).toBe(false);

      // Nothing anywhere in the workspace may reintroduce the generator, and
      // no tracked file may be a schema it produced.
      const tracked = execFileSync(
        "git",
        ["ls-files", "*.zod.generated.ts", "*/types.generated.ts", "ts-to-zod.config.*"],
        { cwd: REPO_ROOT, encoding: "utf8" },
      ).trim();
      expect(tracked).toBe("");
    });
  });
});
