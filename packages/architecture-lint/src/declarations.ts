import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const FORBIDDEN_DECLARATION = [
  { pattern: /@prisma\/client/, name: "Prisma" },
  { pattern: /generated\/prisma/, name: "generated Prisma" },
  { pattern: /platform\/app|~\//, name: "application source" },
  {
    pattern: /repositories\/prisma|repositories\.[cm]?[jt]s/,
    name: "private repositories",
  },
] as const;

function publicSourceTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>).flatMap(
    publicSourceTargets,
  );
}

function publicDeclarationFiles(pkg: ClassifiedPackage): Set<string> {
  return new Set(
    publicSourceTargets(pkg.manifest.exports)
      .filter((target) => /\.[cm]?tsx?$/.test(target))
      .map((target) => join(pkg.root, target).replace(/\.[cm]?tsx?$/, ".d.ts")),
  );
}

export function lintDeclarations(
  packages: ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of packages) {
    const tsconfigPath = join(pkg.root, "tsconfig.json");
    if (!existsSync(tsconfigPath)) continue;
    const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (read.error) continue;
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      dirname(tsconfigPath),
      {
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
        noEmitOnError: false,
      },
      tsconfigPath,
    );
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const publicFiles = publicDeclarationFiles(pkg);
    const outputs = new Map<string, string>();
    program.emit(undefined, (file, text) => {
      if (file.endsWith(".d.ts")) outputs.set(file, text);
    });
    for (const [file, source] of outputs) {
      if (!publicFiles.has(file)) continue;
      for (const forbidden of FORBIDDEN_DECLARATION) {
        if (forbidden.pattern.test(source)) {
          violations.push({
            policy: "public-declarations",
            file,
            message: `Public declaration leaks ${forbidden.name}.`,
          });
        }
      }
    }
  }
  return violations;
}
