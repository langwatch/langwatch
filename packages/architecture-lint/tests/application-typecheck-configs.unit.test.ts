import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function withApplication(application: string, check: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "langwatch-fast-typecheck-"));
  try {
    for (const filename of ["tsconfig.json", "tsconfig.test.json"]) {
      const source = join(root, "apps", application, filename);
      const parsed = ts.parseConfigFileTextToJson(source, readFileSync(source, "utf8"));
      expect(parsed.error).toBeUndefined();
      const config = parsed.config;
      if (filename === "tsconfig.json") config.extends = join(root, "tsconfig.base.json");
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

describe.each(["api", "worker", "ui"])("%s application typecheck modes", (application) => {
  it("excludes test entrypoints from fast checks and includes them in full checks", () => {
    withApplication(application, (directory) => {
      expect(diagnostics(directory, "tsconfig.json")).toEqual([]);
      const full = diagnostics(directory, "tsconfig.test.json");
      expect(full).toHaveLength(2);
      expect(full.map((error) => error.code)).toEqual([2322, 2322]);
      expect(full.map((error) => error.file)).toEqual(
        expect.arrayContaining([
          join(directory, "src/failure.test.ts"),
          join(directory, "src/__tests__/failure.ts"),
        ]),
      );
    });
  });

  it("still checks a test file imported by production", () => {
    withApplication(application, (directory) => {
      writeFileSync(join(directory, "src/main.ts"), 'export { value } from "./failure.test.ts";');
      expect(diagnostics(directory, "tsconfig.json")).toEqual([
        { code: 2322, file: join(directory, "src/failure.test.ts") },
      ]);
    });
  });
});
