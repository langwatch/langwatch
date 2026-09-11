import { existsSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import ts from "typescript";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "../../baseline.ts";
import { walkFiles } from "../../workspace/layout.ts";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation } from "../../types.ts";

/**
 * A repository whose Prisma implementation and memory twin declare different
 * method sets. `feature-shape` only asks whether a twin exists; a twin three
 * methods short passes that and throws inside a fixture. README, "The dead-code
 * guards"; ADR-137.
 */

const BASELINE_FILE = "memory-twin-drift-baseline.json";

/** Where a module's server package lives, core and enterprise. */
const MODULE_GROUPS = ["modules", join("enterprise", "modules")];

export const MEMORY_TWIN_DRIFT_SIDES = ["prisma", "memory"] as const;

/** Which implementation declares the method the other one lacks. */
export type MemoryTwinDriftSide = (typeof MEMORY_TWIN_DRIFT_SIDES)[number];

export type MemoryTwinDriftFinding = {
  /** The declaring package's directory, repository-relative. */
  packagePath: string;
  /** The repository the two classes both stand for, by name. */
  subject: string;
  side: MemoryTwinDriftSide;
  /** The method only that side declares. */
  method: string;
  /** Repository-relative path of the file that is short of the method. */
  path: string;
  message: string;
  allowed: string;
};

/** Code-unit order, the order every baseline in this package is written in. */
function byKey(left: string, right: string): number {
  if (left === right) return 0;

  return left < right ? -1 : 1;
}

const TEST_DIRECTORIES = new Set(["__tests__", "__mocks__"]);

function isSourceFile(path: string): boolean {
  const name = basename(path);
  if (!/\.tsx?$/.test(name)) return false;

  if (name.endsWith(".d.ts")) return false;

  if (/\.(?:test|spec)\.tsx?$/.test(name)) return false;

  return !path.split(sep).some((segment) => TEST_DIRECTORIES.has(segment));
}

/** Every module server package's repositories directory, core and enterprise. */
export function repositoryRoots(root: string): string[] {
  const manifests = MODULE_GROUPS.flatMap((group) =>
    walkFiles(join(root, group), (path) => basename(path) === "package.json"),
  );

  const roots = manifests.filter((file) => {
    const parts = relative(root, file).split(sep);
    const server = parts.indexOf("server");

    return server > 0 && parts.length === server + 2;
  });

  return roots.map((file) => join(file, "..", "src", "repositories")).sort();
}

/**
 * The tree moves under a walk: a codemod deletes a file between the listing
 * and the parse, and a file that has gone is not in the tree any more.
 */
function statementsOf(file: string): readonly ts.Statement[] {
  return existsSync(file) ? sourceFile({ file }).statements : [];
}

const HIDDEN_MODIFIERS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.StaticKeyword,
]);

/**
 * `static create` is the construction seam every class here carries and says
 * nothing about the repository's surface, so static members are left out along
 * with the private ones.
 */
function isReachable(member: ts.ClassElement): boolean {
  if (!ts.canHaveModifiers(member)) return true;

  const modifiers = ts.getModifiers(member) ?? [];

  return !modifiers.some((modifier) => HIDDEN_MODIFIERS.has(modifier.kind));
}

function methodNameOf(member: ts.ClassElement): string | undefined {
  const callable =
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member);

  if (!callable) return void 0;

  if (!isReachable(member)) return void 0;

  return ts.isIdentifier(member.name) ? member.name.text : void 0;
}

/** The methods a caller can reach on this class. */
function methodNamesOf(declaration: ts.ClassDeclaration): Set<string> {
  const names = declaration.members.flatMap((member) => {
    const name = methodNameOf(member);

    return name === void 0 ? [] : [name];
  });

  return new Set(names);
}

/** Every interface the class says it implements. */
function implementedNames(declaration: ts.ClassDeclaration): string[] {
  const clauses = declaration.heritageClauses ?? [];

  return clauses
    .filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
    .flatMap((clause) => clause.types)
    .flatMap((type) => (ts.isIdentifier(type.expression) ? [type.expression.text] : []));
}

/**
 * What a class is a twin of: its own name with the backend's word taken out,
 * whichever end it sits at, plus every interface it implements. Only a quarter
 * of these classes carry an `implements` clause, so the name pairs the rest.
 */
function subjectsOf({
  declaration,
  word,
}: {
  declaration: ts.ClassDeclaration;
  word: string;
}): string[] {
  const name = declaration.name?.text;
  if (name === void 0) return [];

  const stripped = name.replace(word, "");
  const renamed = stripped !== name && stripped.length > 0;
  const named = renamed ? [stripped] : [];

  return [...new Set([...named, ...implementedNames(declaration)])];
}

type Implementation = { file: string; className: string; methods: Set<string> };

function indexClass({
  declaration,
  file,
  word,
  found,
}: {
  declaration: ts.ClassDeclaration;
  file: string;
  word: string;
  found: Map<string, Implementation>;
}): void {
  const className = declaration.name?.text;
  if (className === void 0) return;

  const methods = methodNamesOf(declaration);

  for (const subject of subjectsOf({ declaration, word })) {
    const known = found.get(subject);

    if (known === void 0) {
      found.set(subject, { file, className, methods });

      continue;
    }

    for (const method of methods) known.methods.add(method);
  }
}

/** The twin each subject has on one side, by subject name. */
function implementationsIn({
  directory,
  word,
}: {
  directory: string;
  word: string;
}): Map<string, Implementation> {
  const found = new Map<string, Implementation>();

  for (const file of walkFiles(directory, isSourceFile)) {
    for (const statement of statementsOf(file)) {
      if (ts.isClassDeclaration(statement))
        indexClass({ declaration: statement, file, word, found });
    }
  }

  return found;
}

function finding({
  packagePath,
  subject,
  side,
  method,
  path,
}: {
  packagePath: string;
  subject: string;
  side: MemoryTwinDriftSide;
  method: string;
  path: string;
}): MemoryTwinDriftFinding {
  const short = side === "prisma" ? "memory twin" : "Prisma repository";
  const holder = side === "prisma" ? "Prisma repository" : "memory twin";

  const remedy =
    side === "prisma"
      ? `Implement \`${method}()\` on the memory twin, or delete it from the Prisma repository ` +
        "if nothing calls it. A twin short of a method fails inside a fixture, where it reads as " +
        "a broken test rather than as an unfinished repository."
      : `Implement \`${method}()\` on the Prisma repository, or delete it from the twin: a ` +
        "method only the in-memory backing carries passes every suite and is missing in " +
        "production. If it is a seeding helper the interface never declares, put it on a " +
        "testing surface of its own rather than on the repository class.";

  return {
    packagePath,
    subject,
    side,
    method,
    path,
    message:
      `\`${subject}\`: the ${holder} declares \`${method}()\` and the ${short} does not. ` +
      "The two are one repository with two backings, and a caller that reaches the method " +
      "through the interface gets whichever of them the process composed.",
    allowed: remedy,
  };
}

/** The key of a memory-twin-drift row. */
function entryKey(entry: {
  packagePath: string;
  subject: string;
  side: MemoryTwinDriftSide;
  method: string;
}): string {
  return `${entry.packagePath}|${entry.subject}|${entry.side}|${entry.method}`;
}

type Drift = { side: MemoryTwinDriftSide; method: string; file: string };

/** Every method one side declares and the other does not, each against the short side. */
function driftBetween({
  onPrisma,
  onMemory,
}: {
  onPrisma: Implementation;
  onMemory: Implementation;
}): Drift[] {
  const missingFromMemory = [...onPrisma.methods]
    .filter((method) => !onMemory.methods.has(method))
    .sort();

  const missingFromPrisma = [...onMemory.methods]
    .filter((method) => !onPrisma.methods.has(method))
    .sort();

  return [
    ...missingFromMemory.map((method) => ({
      side: "prisma" as const,
      method,
      file: onMemory.file,
    })),
    ...missingFromPrisma.map((method) => ({
      side: "memory" as const,
      method,
      file: onPrisma.file,
    })),
  ];
}

/**
 * A class is indexed under its stripped name AND under every interface it
 * implements, so one pair of twins can be reached by two subjects. The defect
 * is the pair of classes: the first subject in code-unit order reports it.
 */
function packageFindings({
  root,
  repositories,
}: {
  root: string;
  repositories: string;
}): MemoryTwinDriftFinding[] {
  const prisma = implementationsIn({ directory: join(repositories, "prisma"), word: "Prisma" });
  if (prisma.size === 0) return [];

  const memory = implementationsIn({ directory: join(repositories, "memory"), word: "Memory" });
  if (memory.size === 0) return [];

  const packagePath = relative(root, join(repositories, "..", ".."));
  const subjects = [...prisma.keys()].sort(byKey);
  const reported = new Set<string>();
  const findings: MemoryTwinDriftFinding[] = [];

  for (const subject of subjects) {
    const onPrisma = prisma.get(subject);
    const onMemory = memory.get(subject);
    const paired = onPrisma !== void 0 && onMemory !== void 0;
    if (!paired) continue;

    findings.push(...pairFindings({ packagePath, subject, onPrisma, onMemory, reported, root }));
  }

  return findings;
}

function pairFindings({
  packagePath,
  subject,
  onPrisma,
  onMemory,
  reported,
  root,
}: {
  packagePath: string;
  subject: string;
  onPrisma: Implementation;
  onMemory: Implementation;
  reported: Set<string>;
  root: string;
}): MemoryTwinDriftFinding[] {
  const pair = `${onPrisma.className}|${onMemory.className}`;

  const fresh = driftBetween({ onPrisma, onMemory }).filter((drift) => {
    const seen = `${pair}|${drift.side}|${drift.method}`;
    if (reported.has(seen)) return false;

    reported.add(seen);

    return true;
  });

  return fresh.map((drift) =>
    finding({
      packagePath,
      subject,
      side: drift.side,
      method: drift.method,
      path: relative(root, drift.file),
    }),
  );
}

export function collectMemoryTwinDriftFindings(root: string): MemoryTwinDriftFinding[] {
  const findings = repositoryRoots(root).flatMap((repositories) =>
    packageFindings({ root, repositories }),
  );

  return findings.sort((left, right) => byKey(entryKey(left), entryKey(right)));
}

export const MEMORY_TWIN_DRIFT_BASELINE: BaselinePolicy = {
  id: "memory-twin-drift",
  file: BASELINE_FILE,
  label: "Memory twin drift baseline",
  keyRule:
    "A key is `<package directory>|<subject>|<side>|<method>`, side one of prisma, memory: the side that declares the method.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Memory twin drift baseline entry ${entry.key.split("|").join(" ")} no longer matches anything and must be removed.`,
  }),
};

export function collectMemoryTwinDriftBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectMemoryTwinDriftFindings(root).map(entryKey);

  return collectBaseline({ policy: MEMORY_TWIN_DRIFT_BASELINE, found, previous });
}

export function lintMemoryTwinDrift(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const policy = MEMORY_TWIN_DRIFT_BASELINE;
  const file = baselinePath({ root, policy });
  const baseline = readBaseline({ policy, file });

  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy, file }),
  ];

  const findings = collectMemoryTwinDriftFindings(root);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map(entryKey));

  const unlisted = findings.filter((one) => !baselined.has(entryKey(one)));

  violations.push(
    ...unlisted.map((one) => ({
      policy: "memory-twin-drift",
      file: join(root, one.path),
      message: one.message,
      allowed: one.allowed,
    })),
  );

  violations.push(...staleRows({ entries: baseline.entries, found, policy, file }));

  return violations;
}
