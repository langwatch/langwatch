import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const FORBIDDEN_DECLARATION = [
  { pattern: /@prisma\/client/, name: "Prisma" },
  { pattern: /generated\/prisma/, name: "generated Prisma" },
  {
    pattern: /@langwatch\/prisma-client\/generated/,
    name: "generated Prisma",
  },
  { pattern: /platform\/app|~\//, name: "application source" },
  {
    pattern: /repositories\/prisma|repositories\.[cm]?[jt]s/,
    name: "private repositories",
  },
] as const;

function publicSourceTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value as Record<string, unknown>).flatMap(publicSourceTargets);
}

function publicDeclarationFiles(pkg: ClassifiedPackage): Set<string> {
  return new Set(
    publicSourceTargets(pkg.manifest.exports)
      .filter((target) => /\.[cm]?tsx?$/.test(target))
      .map((target) => join(pkg.root, target).replace(/\.[cm]?tsx?$/, ".d.ts")),
  );
}

function declarationAt(path: string, outputs: Map<string, string>): string | undefined {
  for (const candidate of [path, `${path}.d.ts`, join(path, "index.d.ts")]) {
    if (outputs.has(candidate)) return candidate;
  }
  return undefined;
}

function reachableDeclarations(roots: Set<string>, outputs: Map<string, string>): Set<string> {
  const reachable = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || reachable.has(file) || !outputs.has(file)) continue;
    reachable.add(file);
    const source = outputs.get(file) ?? "";
    for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const target = declarationAt(resolve(dirname(file), imported.fileName), outputs);
      if (target && !reachable.has(target)) pending.push(target);
    }
  }
  return reachable;
}

export function lintDeclarations(packages: ClassifiedPackage[]): ArchitectureViolation[] {
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
    for (const file of reachableDeclarations(publicFiles, outputs)) {
      const source = outputs.get(file) ?? "";
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
