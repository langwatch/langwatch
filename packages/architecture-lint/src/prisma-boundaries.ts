import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const PRISMA_ROOT = "@langwatch/prisma-client";
const PRISMA_GENERATED = "@langwatch/prisma-client/generated";

type SourceImport = {
  file: string;
  line: number;
  specifier: string;
};

function isWithin(root: string, path: string): boolean {
  const pathFromRoot = relative(root, path);
  const escapesRoot =
    pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || isAbsolute(pathFromRoot);
  return pathFromRoot === "" || !escapesRoot;
}

function sourceLine(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

function sourceImports(root: string): SourceImport[] {
  return walkFiles(root, (file) => {
    const isProductionSource =
      SOURCE_FILE.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
    const isNotTestDirectory =
      !file.includes(`${sep}__tests__${sep}`) && !file.includes(`${sep}__mocks__${sep}`);
    return isProductionSource && isNotTestDirectory;
  }).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return ts.preProcessFile(source, true, true).importedFiles.map(({ fileName, pos }) => ({
      file,
      line: sourceLine(source, pos),
      specifier: fileName,
    }));
  });
}

function generatedImport(specifier: string): boolean {
  return specifier === PRISMA_GENERATED || specifier.startsWith(`${PRISMA_GENERATED}/`);
}

/**
 * Where the concrete Prisma client may be named. Two places, and only two:
 *
 *   1. `server/src/repositories/prisma/**` — the repository IS the Prisma
 *      binding. It knows Prisma; the port that fronts it does not.
 *   2. `server/src/adapters/postgres.*.adapter.ts` — the Postgres composition
 *      seam between a process and a feature. It takes a typed `PrismaClient`
 *      from the composition root, hands it to the repository, and returns the
 *      service. Nothing above this file needs to know a repository class
 *      exists.
 *
 * A file outside both places that imports `PrismaClient` is a leak — every
 * other layer speaks to Prisma only through the port the repository fronts.
 * That is the invariant `service-repository-adapter-port.md` documents.
 */
/**
 * Composition roots (applications, enterprise compositions) are the seam
 * CLAUDE.md names for the typed Prisma client: a composition, mount, or
 * infrastructure file that wires it into a feature's adapter. Feature
 * packages get no such allowance — a service, port or transport there stays
 * a violation (see A6/A7 in the burn-down plan).
 */
function isCompositionRoot(pkg: ClassifiedPackage): boolean {
  return pkg.kind === "application" || pkg.kind === "enterprise-composition";
}

function isCompositionPrismaSeam(file: string): boolean {
  if (/\.composition\.ts$/.test(file)) return true;
  if (/\.mount\.ts$/.test(file)) return true;
  if (/\.adapter\.ts$/.test(file)) return true;
  if (file.includes(`${sep}src${sep}platform${sep}infrastructure${sep}`)) return true;
  return false;
}

function isStrictPrismaAdapter(pkg: ClassifiedPackage, file: string): boolean {
  if (isCompositionRoot(pkg)) return isCompositionPrismaSeam(file);
  if (pkg.kind !== "server") return false;
  if (isWithin(join(pkg.root, "src", "repositories", "prisma"), file)) return true;
  return /\/src\/adapters\/postgres\.[^/]+\.adapter\.ts$/.test(file);
}

export function lintPrismaBoundaries(packages: ClassifiedPackage[]): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  for (const pkg of packages) {
    for (const sourceImport of sourceImports(join(pkg.root, "src"))) {
      if (
        generatedImport(sourceImport.specifier) &&
        !isStrictPrismaAdapter(pkg, sourceImport.file)
      ) {
        violations.push({
          policy: "prisma-containment",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message:
            "Generated Prisma may only be imported by a repository under server/src/repositories/prisma or the Postgres composition adapter (server/src/adapters/postgres.<subject>.adapter.ts).",
          allowed:
            "Below server/src/repositories/prisma: the repository binds Prisma to the port. In server/src/adapters/postgres.<subject>.adapter.ts: the adapter takes a typed PrismaClient from the composition root and hands it to the repository. Every other file speaks to Prisma through the port.",
        });
      }

      if (pkg.feature && sourceImport.specifier === PRISMA_ROOT) {
        violations.push({
          policy: "prisma-containment",
          file: sourceImport.file,
          line: sourceImport.line,
          specifier: sourceImport.specifier,
          message: "Feature packages cannot own Prisma connection or lifecycle services.",
          allowed:
            "Applications and composition roots construct @langwatch/prisma-client; feature services depend on narrow repository ports.",
        });
      }
    }
  }
  return violations;
}
