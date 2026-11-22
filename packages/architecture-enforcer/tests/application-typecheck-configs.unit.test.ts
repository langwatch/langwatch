import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function withApplication(application: string, check: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "langwatch-fast-typecheck-"));
  try {
    for (const filename of ["tsconfig.json", "tsconfig.app.json"]) {
      const source = join(root, "apps", application, filename);
      const parsed = ts.parseConfigFileTextToJson(source, readFileSync(source, "utf8"));
      expect(parsed.error).toBeUndefined();
      const config = parsed.config;
      // The applications extend tsconfig.base.json, which is tsconfig.shared.json plus
      // options only TypeScript 7 reads; this API is TypeScript 6 and refuses them.
      if (filename === "tsconfig.json") config.extends = join(root, "tsconfig.shared.json");
      writeFileSync(join(directory, filename), JSON.stringify(config));
    }
    mkdirSync(join(directory, "src/__tests__"), { recursive: true });
    writeFileSync(join(directory, "src/main.ts"), "export const value: number = 1;");
    writeFileSync(
      join(directory, "src/failure.test.ts"),
      'export const value: number = "invalid";',
    );
    writeFileSync(
      join(directory, "src/__tests__/failure.ts"),
      'export const value: number = "invalid";',
    );
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function diagnostics(directory: string, filename: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(directory, filename),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (error) => {
        throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
      },
    },
  );
  if (!parsed) throw new Error("The application config could not be parsed");
  expect(parsed.errors).toEqual([]);
  const program = ts.createProgram(parsed.fileNames, {
    ...parsed.options,
    incremental: false,
    types: [],
  });
  return program.getSemanticDiagnostics().map((error) => ({
    code: error.code,
    file: error.file?.fileName,
  }));
}

function parse(directory: string, filename: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(directory, filename),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (error) => {
        throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
      },
    },
  );
  if (!parsed) throw new Error(`${filename} could not be parsed`);
  return parsed;
}

describe.each(["api", "worker", "ui"])("%s application typecheck configuration", (application) => {
  /** @scenario "An application checks its sources and its tests in one configuration" */
  it("includes test directories and colocated test files in its check", () => {
    withApplication(application, (directory) => {
      const full = diagnostics(directory, "tsconfig.app.json");
      expect(full.map((error) => error.code)).toEqual([2322, 2322]);
      expect(full.map((error) => error.file)).toEqual(
        expect.arrayContaining([
          join(directory, "src/failure.test.ts"),
          join(directory, "src/__tests__/failure.ts"),
        ]),
      );
    });
  });

  /** @scenario "An application checks its sources and its tests in one configuration" */
  it("compiles no file of its own in the solution tsconfig.json", () => {
    withApplication(application, (directory) => {
      expect(parse(directory, "tsconfig.json").fileNames).toEqual([]);
    });
  });

  /** @scenario "An application checks its sources and its tests in one configuration" */
  it("builds the solution, which references only the check configuration, as its typecheck", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "apps", application, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const solution = parse(join(root, "apps", application), "tsconfig.json");

    expect(manifest.scripts?.typecheck).toMatch(/^(?:[A-Z_]+=\S+ )*tsc -b$/);
    expect(solution.projectReferences?.map((reference) => reference.path)).toEqual([
      join(root, "apps", application, "tsconfig.app.json"),
    ]);
  });
});
