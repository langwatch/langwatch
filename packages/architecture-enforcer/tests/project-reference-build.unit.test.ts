/**
 * @vitest-environment node
 * @see specs/setup/typescript-7.feature
 */

/**
 * What a project reference buys a package: `tsc -b` builds the referenced dependency's
 * declarations first and resolves them instead of its source. The references themselves
 * are written by `nx sync` (ADR-150, 2026-10-10).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REAL_BUILD_TIMEOUT_MS = 60_000;

describe("given a package's project actually references its adopted dependency", () => {
  let buildRoot = "";

  beforeEach(() => {
    buildRoot = mkdtempSync(join(tmpdir(), "project-reference-build-"));
  });

  afterEach(() => {
    rmSync(buildRoot, { recursive: true, force: true });
  });

  function writeProject(
    relative: string,
    sourceText: string,
    options: Record<string, unknown> = {},
  ): string {
    const directory = join(buildRoot, relative);
    mkdirSync(join(directory, "src"), { recursive: true });
    writeFileSync(join(directory, "src/index.ts"), sourceText);
    writeFileSync(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          composite: true,
          outDir: "dist",
          rootDir: "src",
          skipLibCheck: true,
          module: "commonjs",
          target: "es2020",
          noEmitOnError: true,
        },
        include: ["src"],
        ...options,
      }),
    );
    return directory;
  }

  function build(entry: string) {
    const host = ts.createSolutionBuilderHost(
      ts.sys,
      undefined,
      () => {},
      () => {},
    );
    return ts.createSolutionBuilder(host, [entry], {}).build();
  }

  function semanticDiagnosticCount(directory: string): number {
    const parsed = ts.getParsedCommandLineOfConfigFile(
      join(directory, "tsconfig.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (error) => {
          throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
        },
      },
    );
    if (!parsed) throw new Error("The project config could not be parsed");
    const program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false });
    return program.getSemanticDiagnostics().length;
  }

  function writeDependencyAndConsumer() {
    const dependency = writeProject("dependency", "export const value = 1;");
    const consumer = writeProject(
      "consumer",
      'import { value } from "../../dependency/dist/index";\nexport const doubled: number = value * 2;',
      { references: [{ path: "../dependency" }] },
    );
    return { dependency, consumer };
  }

  describe("when the package is typechecked", () => {
    /** @scenario "A package's adopted dependencies are checked before its own source" */
    it(
      "builds the dependency's declarations first and resolves them instead of its source",
      () => {
        const { dependency, consumer } = writeDependencyAndConsumer();

        expect(build(consumer)).toBe(ts.ExitStatus.Success);
        expect(existsSync(join(dependency, "dist/index.d.ts"))).toBe(true);
        expect(existsSync(join(consumer, "dist/index.js"))).toBe(true);
      },
      REAL_BUILD_TIMEOUT_MS,
    );

    /** @scenario "A package's adopted dependencies are checked before its own source" */
    it(
      "still reports a type error against the dependency's own exports",
      () => {
        const { consumer } = writeDependencyAndConsumer();
        build(consumer);

        writeFileSync(
          join(consumer, "src/index.ts"),
          'import { value } from "../../dependency/dist/index";\nexport const bad: string = value;',
        );

        expect(semanticDiagnosticCount(consumer)).toBeGreaterThan(0);
      },
      REAL_BUILD_TIMEOUT_MS,
    );

    /** @scenario "A package's adopted dependencies are checked before its own source" */
    it(
      "a failed dependency build stops the package's own build",
      () => {
        const { dependency, consumer } = writeDependencyAndConsumer();
        build(consumer);

        writeFileSync(
          join(dependency, "src/index.ts"),
          'export const value: number = "not a number";',
        );
        rmSync(join(dependency, "dist"), { recursive: true, force: true });
        rmSync(join(consumer, "dist"), { recursive: true, force: true });

        expect(build(consumer)).not.toBe(ts.ExitStatus.Success);
        expect(existsSync(join(dependency, "dist/index.d.ts"))).toBe(false);
        expect(existsSync(join(consumer, "dist/index.js"))).toBe(false);
      },
      REAL_BUILD_TIMEOUT_MS,
    );
  });
});
