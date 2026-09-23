import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

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

/**
 * The declaration text with comments blanked to spaces (offsets kept): JSDoc copied into `.d.ts`
 * mentioning a forbidden path was 40 of 310 false findings. Strings are kept; import specifiers are
 * strings.
 */
function withoutComments(source: string): string {
  const out = source.split("");
  let index = 0;
  let quote = "";

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";

      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        out[index] = " ";
        index += 1;
      }

      continue;
    }

    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;

      for (let at = index; at < stop; at += 1) {
        if (source[at] !== "\n") out[at] = " ";
      }

      index = stop;
      continue;
    }

    index += 1;
  }

  return out.join("");
}

/** A source the build compiles; a `.d.ts` is an input the build copies, not one it emits from. */
const SOURCE_FILE = /\.[cm]?tsx?$/;
const DECLARATION_FILE = /\.d\.[cm]?ts$/;

function publicSourceTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];

  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.values(value as Record<string, unknown>).flatMap(publicSourceTargets);
}

/**
 * Declarations name their neighbours the way the source did — `./x.ts`, and
 * `./x.js` where the build rewrites extensions — while the emitted file beside
 * them is `./x.d.ts`. A specifier is resolved against what the build wrote.
 */
function declarationCandidates(path: string): string[] {
  const emitted = path.replace(/\.([cm]?)[jt]sx?$/, (_, modifier: string) => `.d.${modifier}ts`);

  return [path, emitted, `${path}.d.ts`, join(path, "index.d.ts")];
}

/** The 1-based line an offset into a declaration falls on. */
function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function declarationAt(path: string, outputs: Map<string, string>): string | undefined {
  for (const candidate of declarationCandidates(path)) {
    if (outputs.has(candidate)) return candidate;
  }

  return undefined;
}

function reachableDeclarations(roots: Set<string>, outputs: Map<string, string>): Set<string> {
  const reachable = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file) continue;

    const alreadyDone = reachable.has(file) || !outputs.has(file);
    if (alreadyDone) continue;

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

/** One parse per configuration file in a run: the web packages all share a single project. */
type ParsedProjects = Map<string, ts.ParsedCommandLine | undefined>;

function parseProject(
  configPath: string,
  parsed: ParsedProjects,
): ts.ParsedCommandLine | undefined {
  if (!parsed.has(configPath)) parsed.set(configPath, readProject(configPath));

  return parsed.get(configPath);
}

function readProject(configPath: string): ts.ParsedCommandLine | undefined {
  if (!existsSync(configPath)) return void 0;

  const read = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (read.error) return void 0;

  return ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    dirname(configPath),
    void 0,
    configPath,
  );
}

function compiles(project: ts.ParsedCommandLine, pkg: ClassifiedPackage): boolean {
  return project.fileNames.some((file) => file.startsWith(`${pkg.root}${sep}`));
}

/**
 * The project that emits a package's declarations: its own build configuration,
 * or — for the web packages, whose build configuration carries no sources of its
 * own — the shared declaration group it references.
 */
function emittingProject(
  pkg: ClassifiedPackage,
  parsed: ParsedProjects,
): ts.ParsedCommandLine | undefined {
  const build = parseProject(join(pkg.root, "tsconfig.build.json"), parsed);
  if (!build) return void 0;

  if (compiles(build, pkg)) return build;

  for (const reference of build.projectReferences ?? []) {
    const configPath = reference.path.endsWith(".json")
      ? reference.path
      : join(reference.path, "tsconfig.json");

    const referenced = parseProject(configPath, parsed);

    if (referenced && compiles(referenced, pkg)) return referenced;
  }

  return void 0;
}

/** Each of the package's sources against the declaration the build writes for it. */
function emittedDeclarations(
  pkg: ClassifiedPackage,
  project: ts.ParsedCommandLine,
): Map<string, string> {
  const declarations = new Map<string, string>();

  for (const source of project.fileNames) {
    const owned =
      source.startsWith(`${pkg.root}${sep}`) &&
      SOURCE_FILE.test(source) &&
      !DECLARATION_FILE.test(source);

    if (!owned) continue;

    const declaration = ts
      .getOutputFileNames(project, source, false)
      .find((output) => DECLARATION_FILE.test(output));

    if (declaration) declarations.set(source, declaration);
  }

  return declarations;
}

function publicDeclarationFiles(
  pkg: ClassifiedPackage,
  declarations: Map<string, string>,
  outputs: Map<string, string>,
): Set<string> {
  const roots = new Set<string>();

  for (const target of publicSourceTargets(pkg.manifest.exports)) {
    const path = join(pkg.root, target);
    const declaration = declarations.get(path);

    if (declaration) roots.add(declaration);
    else if (outputs.has(path)) roots.add(path);
  }

  return roots;
}

/**
 * A package the build has not produced is not a passing package: it is an
 * unread input, and reporting nothing for it turns the gate off silently.
 */
function missingBuildRefusal(
  pkg: ClassifiedPackage,
  missing: readonly string[],
  total: number,
): ArchitectureViolation {
  const [first] = missing;

  return {
    policy: "public-declarations",
    file: join(pkg.root, "tsconfig.build.json"),
    message: `${pkg.name} has no declarations to read: the build has not written ${missing.length} of its ${total} declaration files, starting at ${first ?? ""}.`,
    allowed:
      "Run pnpm typecheck (tsc -b) so the declarations exist; this policy reads the build's own output and cannot judge a package that was never built.",
  };
}

/** Emitted `.d.ts` violations for one package, or `undefined` when nothing emits for it. */
function violationsForPackage(
  pkg: ClassifiedPackage,
  parsed: ParsedProjects,
): ArchitectureViolation[] | undefined {
  const project = emittingProject(pkg, parsed);
  if (!project) return void 0;

  const declarations = emittedDeclarations(pkg, project);
  if (declarations.size === 0) return void 0;

  const outputs = new Map<string, string>();
  const missing: string[] = [];

  for (const declaration of declarations.values()) {
    if (existsSync(declaration)) outputs.set(declaration, readFileSync(declaration, "utf8"));
    else missing.push(declaration);
  }

  if (missing.length > 0) return [missingBuildRefusal(pkg, missing, declarations.size)];

  const violations: ArchitectureViolation[] = [];

  for (const file of reachableDeclarations(
    publicDeclarationFiles(pkg, declarations, outputs),
    outputs,
  )) {
    const source = withoutComments(outputs.get(file) ?? "");

    for (const forbidden of FORBIDDEN_DECLARATION) {
      const leak = forbidden.pattern.exec(source);
      if (!leak) continue;

      violations.push({
        policy: "public-declarations",
        file,
        line: lineOf(source, leak.index),
        message: `Public declaration leaks ${forbidden.name}.`,
      });
    }
  }

  return violations;
}

export function lintDeclarations(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const parsed: ParsedProjects = new Map();

  return snapshot.packages.flatMap((pkg) => violationsForPackage(pkg, parsed) ?? []);
}
