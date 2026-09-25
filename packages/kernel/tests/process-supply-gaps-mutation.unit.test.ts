import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");

const mutations = {
  "supply-token namespace": {
    file: "src/supply-token.ts",
    mutate(source: string) {
      return source
        .replace(
          'import type { OperationsOnly } from "./module-api-token.ts";',
          'import type { OperationsOnly } from "./module-api-token.ts";\nimport type { ModuleName } from "./module-namespace.ts";',
        )
        .replace("Name extends string = string", "Name extends ModuleName = ModuleName")
        .replaceAll("const Name extends string", "const Name extends ModuleName");
    },
    diagnostic: "licenseSource",
  },
  "selected repository tier": {
    file: "src/process-supply.types.ts",
    mutate(source: string) {
      return source.replace(
        'ProviderMembers<Module extends { readonly tier: "memory" } ? Memory : Live>',
        "ProviderMembers<Live>",
      );
    },
    diagnostic: "relational",
  },
  "closed custom members": {
    file: "src/process-supply.ts",
    mutate(source: string) {
      return source
        .replace("const Name extends keyof RequiredMemberSet & string", "const Name extends string")
        .replace("Value extends MemberValueFrom<RequiredMemberSet, Name>", "Value");
    },
    diagnostic: "Unused '@ts-expect-error' directive",
  },
  "package root createApp": {
    file: "src/index.ts",
    mutate(source: string) {
      return source.replace(
        'export { createApp, ProcessSupply, type ExposedSurface } from "./process-supply.ts";',
        'export { ProcessSupply, type ExposedSurface } from "./process-supply.ts";',
      );
    },
    diagnostic: "createApp",
  },
} satisfies Readonly<
  Record<
    string,
    {
      readonly file: string;
      readonly mutate: (source: string) => string;
      readonly diagnostic: string;
    }
  >
>;

describe("process supply gap probes", () => {
  it.each(Object.entries(mutations))("fails when %s is gutted", (_name, mutation) => {
    const directory = mkdtempSync(resolve(packageRoot, ".process-supply-gaps-"));
    try {
      cpSync(resolve(packageRoot, "src"), resolve(directory, "src"), { recursive: true });
      mkdirSync(resolve(directory, "tests"));
      mkdirSync(resolve(directory, "type-tests"));
      cpSync(
        resolve(packageRoot, "tests/process-supply.fixtures.ts"),
        resolve(directory, "tests/process-supply.fixtures.ts"),
      );
      cpSync(
        resolve(packageRoot, "type-tests/process-supply.ts"),
        resolve(directory, "type-tests/process-supply.ts"),
      );

      const mutatedPath = resolve(directory, mutation.file);
      const source = readFileSync(mutatedPath, "utf8");
      const mutated = mutation.mutate(source);
      if (mutated === source) throw new Error(`The ${mutation.file} mutation did not apply.`);
      writeFileSync(mutatedPath, mutated);
      writeFileSync(
        resolve(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            allowImportingTsExtensions: true,
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: "ES2022",
            types: ["node"],
          },
          files: ["type-tests/process-supply.ts"],
        }),
      );

      let output = "";
      try {
        execFileSync(
          resolve(packageRoot, "node_modules/typescript/bin/tsc"),
          ["--project", resolve(directory, "tsconfig.json"), "--pretty", "false"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (error) {
        if (!(error instanceof Error) || !("stdout" in error) || typeof error.stdout !== "string") {
          throw error;
        }
        output = error.stdout;
      }

      expect(output).toContain(mutation.diagnostic);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
