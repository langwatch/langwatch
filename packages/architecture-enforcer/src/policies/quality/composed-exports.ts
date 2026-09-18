import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

import ts from "typescript";

import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  liveKeys,
  readBaseline,
  shrinkCheck,
  staleRows,
} from "../../baseline.ts";
import type { ArchitectureViolation } from "../../types.ts";
import {
  workspaceModuleResolver,
  sourceFile,
  sourceText,
  walkValueImportGraph,
  type WorkspaceModuleResolver,
} from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/** Guard that exported capabilities are actually composed (reachability, not just existence);
 * see composed-exports-baseline.json for exclusions and full rules */
const BASELINE_FILE = "composed-exports-baseline.json";

/**
 * The process entrypoints. Compositions are deliberately NOT roots: a
 * composition no entrypoint reaches is exactly the hole this rule exists to
 * see, and seeding the walk with it would hide every orphan composition.
 */
const ENTRYPOINTS = [
  "apps/api/src/main.ts",
  "apps/worker/src/main.ts",
  "packages/scenario-child/src/scenario-child.entrypoint.ts",
  "apps/tasks/src/tasks.entrypoint.ts",
  "apps/server/src/cli.ts",
];

/** Suffixes that name a collaborator a composition root builds. */
const SUBJECT_SUFFIXES = ["Service", "Adapter", "Repository", "Process", "Api"];

/** Exported factory functions that mount or build a transport. */
const TRANSPORT_FACTORY = /^create[A-Z][A-Za-z0-9]*(?:RestApp|Api|Router)$/;

const EXCLUDED_SUFFIXES = ["Port", "Error", "Schema"];

const EXCLUDED_PACKAGE_SUFFIXES = ["-web", "-contract", "-ui"];

export type ComposedExportSubject = {
  /** `<package directory>|<exported name>`, the baseline key. */
  key: string;
  name: string;
  packagePath: string;
  indexFile: string;
  declaringFile: string;
};

function isTestingModule(file: string): boolean {
  return (
    file.includes(`${sep}testing${sep}`) ||
    basename(file) === "testing.ts" ||
    basename(file).endsWith(".testing.ts") ||
    file.includes(`${sep}__tests__${sep}`)
  );
}

function isSubjectName(name: string): boolean {
  for (const suffix of EXCLUDED_SUFFIXES) {
    if (name.endsWith(suffix)) return false;
  }

  if (TRANSPORT_FACTORY.test(name)) return true;

  return SUBJECT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function parseFile(file: string): ts.SourceFile {
  return sourceFile({ file, kind: file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS });
}

function subdirectories(path: string): string[] {
  if (!existsSync(path)) return [];

  const stat = statSync(path);
  if (!stat.isDirectory()) return [];

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/**
 * The server package indexes this rule reads: every feature's `process` role
 * and the server-side infrastructure packages under `packages/`. Derived, not
 * listed — a hand-written list only guards what somebody remembered to add.
 */
export function serverPackageIndexes({ root }: { root: string }): string[] {
  const indexes: string[] = [];

  const push = (file: string): void => {
    if (existsSync(file)) indexes.push(file);
  };

  for (const group of [join(root, "modules"), join(root, "enterprise", "modules")]) {
    for (const feature of subdirectories(group)) {
      push(join(group, feature, "process", "src", "index.ts"));
    }
  }

  for (const name of subdirectories(join(root, "packages"))) {
    let isExcludedPackage = false;

    for (const suffix of EXCLUDED_PACKAGE_SUFFIXES) {
      if (name.endsWith(suffix)) {
        isExcludedPackage = true;
        break;
      }
    }

    if (isExcludedPackage) continue;

    const serverDir = join(root, "packages", name, "src", "server");
    if (!existsSync(serverDir)) continue;

    push(join(root, "packages", name, "src", "index.ts"));
  }

  return indexes.toSorted();
}

type ExportedName = { name: string; declaringFile: string };

/**
 * Every value name an index publishes, mapped to the module that declares it.
 * Type-only clauses and specifiers are skipped: an erased export composes.
 */
function exportedNames({
  file,
  resolveSpecifier,
  seen,
}: {
  file: string;
  resolveSpecifier: (options: { specifier: string; file: string }) => string | undefined;
  seen: Set<string>;
}): ExportedName[] {
  if (seen.has(file)) return [];

  seen.add(file);
  const source = parseFile(file);
  const names: ExportedName[] = [];

  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;

      const target =
        statement.moduleSpecifier !== void 0 && ts.isStringLiteralLike(statement.moduleSpecifier)
          ? resolveSpecifier({ specifier: statement.moduleSpecifier.text, file })
          : void 0;

      if (statement.exportClause === void 0) {
        if (target !== void 0)
          names.push(...exportedNames({ file: target, resolveSpecifier, seen }));

        continue;
      }

      if (!ts.isNamedExports(statement.exportClause)) continue;

      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;

        names.push({ name: element.name.text, declaringFile: target ?? file });
      }

      continue;
    }

    const exported = ts.canHaveModifiers(statement)
      ? ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      : false;

    if (exported !== true) continue;

    if (ts.isClassDeclaration(statement)) {
      if (statement.name) names.push({ name: statement.name.text, declaringFile: file });
    }

    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name) names.push({ name: statement.name.text, declaringFile: file });
    }
  }

  return names;
}

const ABSTRACT_CLASS = /^export\s+(?:declare\s+)?abstract\s+class\s+([A-Za-z0-9_$]+)/gm;

const CLASS_HERITAGE =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)\s+extends\s+([\w$.]+)/gm;

const excludedDeclarations = new Map<string, Set<string>>();

/**
 * An abstract class is a port; a class extending an Error is an error. By
 * pattern, not parse: a class header is unambiguous in text and cheaper.
 */
function isExcludedDeclaration({ name, file }: { name: string; file: string }): boolean {
  let excluded = excludedDeclarations.get(file);

  if (excluded === void 0) {
    excluded = new Set<string>();
    excludedDeclarations.set(file, excluded);
    const text = existsSync(file) ? sourceText({ file }) : "";
    for (const match of text.matchAll(ABSTRACT_CLASS)) excluded.add(match[1]!);

    for (const match of text.matchAll(CLASS_HERITAGE)) {
      if (match[2]!.endsWith("Error")) excluded.add(match[1]!);
    }
  }

  return excluded.has(name);
}

export function collectComposedExportSubjects({
  root,
  resolver,
}: {
  root: string;
  resolver?: WorkspaceModuleResolver;
}): ComposedExportSubject[] {
  const resolveSpecifier = (resolver ?? workspaceModuleResolver({ root })).resolve;
  const subjects: ComposedExportSubject[] = [];
  const claimed = new Set<string>();

  for (const indexFile of serverPackageIndexes({ root })) {
    const packagePath = relative(root, resolve(indexFile, "..", ".."));

    for (const exported of exportedNames({
      file: indexFile,
      resolveSpecifier,
      seen: new Set<string>(),
    })) {
      if (!isSubjectName(exported.name)) continue;

      if (isTestingModule(exported.declaringFile)) continue;

      if (isExcludedDeclaration({ name: exported.name, file: exported.declaringFile })) continue;

      const key = `${packagePath}|${exported.name}`;
      if (claimed.has(key)) continue;

      claimed.add(key);

      subjects.push({
        key,
        name: exported.name,
        packagePath,
        indexFile: relative(root, indexFile),
        declaringFile: relative(root, exported.declaringFile),
      });
    }
  }

  return subjects.toSorted((a, b) => a.key.localeCompare(b.key));
}

/**
 * Trees the walk stops on: a contract publishes wire shapes, a browser
 * package is browser code, `dist` is build output — none composes anything,
 * so descending buys nothing and costs a quarter of the parse budget.
 */
const TERMINAL = /(?:\/dist\/|\/contract\/|-contract\/|\/browser\/|-browser\/)/;

/** Every file the entrypoints reach through value imports. */
export function reachableFiles({
  root,
  resolver,
}: {
  root: string;
  resolver?: WorkspaceModuleResolver;
}): Set<string> {
  const roots = ENTRYPOINTS.map((path) => join(root, path)).filter((path) => existsSync(path));

  const graph = walkValueImportGraph({
    roots,
    resolve: (resolver ?? workspaceModuleResolver({ root })).resolve,
    forbidden: () => void 0,
    terminal: ({ file }) => TERMINAL.test(file),
  });

  return new Set(graph.children.keys());
}

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Every word a file contains. Only a prefilter: a file whose text never says
 * the name cannot construct it, and the rest are the ones worth parsing.
 */
function mentionedWords({ file }: { file: string }): Set<string> {
  return new Set(sourceText({ file }).match(IDENTIFIER) ?? []);
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node & { name?: ts.Node };

  return parent?.name === node && !ts.isPropertyAccessExpression(parent);
}

/** Wanted names used as VALUES only (new X(, X.create(, X composed); skips imports/exports,
 * types, declaring module; AST parse to skip comments */
function valueReferences({
  file,
  wanted,
  declaredHere,
}: {
  file: string;
  wanted: ReadonlySet<string>;
  declaredHere: ReadonlySet<string>;
}): string[] {
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    // `class X extends Y` needs Y at runtime, so an extends clause is a value
    // reference even though the node it hangs on is a type node. `implements`
    // is erased and stays excluded.
    if (ts.isExpressionWithTypeArguments(node)) {
      const clause = node.parent;

      if (ts.isHeritageClause(clause) && clause.token === ts.SyntaxKind.ExtendsKeyword) {
        visit(node.expression);
      }

      return;
    }

    if (ts.isImportDeclaration(node)) return;

    if (ts.isExportDeclaration(node)) return;

    if (ts.isImportEqualsDeclaration(node)) return;

    if (ts.isTypeAliasDeclaration(node)) return;

    if (ts.isInterfaceDeclaration(node)) return;

    if (ts.isTypeNode(node)) return;

    if (ts.isIdentifier(node)) {
      if (!wanted.has(node.text)) return;

      if (declaredHere.has(node.text)) return;

      if (isDeclarationName(node)) return;

      found.push(node.text);

      return;
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(parseFile(file), visit);

  return found;
}

export function collectUncomposedExports({ root }: { root: string }): ComposedExportSubject[] {
  const resolver = workspaceModuleResolver({ root });
  const subjects = collectComposedExportSubjects({ root, resolver });
  const wanted = new Set(subjects.map((subject) => subject.name));
  const declaredIn = new Map<string, Set<string>>();

  for (const subject of subjects) {
    const file = join(root, subject.declaringFile);
    const names = declaredIn.get(file) ?? new Set<string>();
    names.add(subject.name);
    declaredIn.set(file, names);
  }

  const composed = new Set<string>();

  for (const file of reachableFiles({ root, resolver })) {
    if (!/\.[cm]?tsx?$/.test(file)) continue;

    if (file.endsWith(".d.ts")) continue;

    const words = mentionedWords({ file });
    let candidate = false;

    for (const word of words) {
      if (!wanted.has(word)) continue;

      if (composed.has(word)) continue;

      candidate = true;
    }

    if (!candidate) continue;

    const declaredHere = declaredIn.get(file) ?? new Set<string>();
    for (const name of valueReferences({ file, wanted, declaredHere })) composed.add(name);
  }

  return subjects.filter((subject) => !composed.has(subject.name));
}

export const COMPOSED_EXPORTS_BASELINE: BaselinePolicy = {
  id: "composed-exports",
  file: BASELINE_FILE,
  label: "Composed-exports baseline",
  keyRule: "A key is `<package directory>|<exported name>`.",
  enforceExpiry: false,
  stale: (entry) => ({
    message: `Composed-exports baseline entry ${entry.key} names an export no application leaves uncomposed.`,
    allowed: "Delete the stale entry; the register only shrinks.",
  }),
  growth: {
    added: (entry) => ({
      message: `Baseline entry ${entry.key} is not in the merge base; the composed-exports baseline is shrink-only.`,
      allowed:
        "Compose the capability in the owning *.composition.ts, or delete it, and remove the entry; do not add new ones.",
    }),
  },
};

function baselineFile(root: string): string {
  return baselinePath({ root, policy: COMPOSED_EXPORTS_BASELINE });
}

export function collectComposedExportsBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectUncomposedExports({ root }).map((subject) => subject.key);

  return collectBaseline({ policy: COMPOSED_EXPORTS_BASELINE, found, previous });
}

export function lintComposedExports(
  snapshot: WorkspaceSnapshot,
  options?: { baselineFile?: string },
): ArchitectureViolation[] {
  const { root } = snapshot;
  const file = options?.baselineFile ?? baselineFile(root);
  const baseline = readBaseline({ policy: COMPOSED_EXPORTS_BASELINE, file });
  const baselined = liveKeys({ entries: baseline.entries });
  const violations: ArchitectureViolation[] = [...baseline.violations];
  const found = new Set<string>();

  for (const subject of collectUncomposedExports({ root })) {
    found.add(subject.key);
    if (baselined.has(subject.key)) continue;

    violations.push({
      policy: "composed-exports",
      // Absolute, matching every other policy's convention: `lintPolicies`
      // relativizes to `root` once. `subject.indexFile` is already
      // root-relative, so passing it through here double-joined it against
      // `process.cwd()` instead, producing an unnavigable reported path.
      file: join(root, subject.indexFile),
      message: `\`${subject.name}\` is exported from \`${subject.packagePath}\` and composed by no application. Compose it in the owning \`*.composition.ts\`, or delete it and its tests.`,
      allowed: `Construct it on a path reachable from ${ENTRYPOINTS.join(", ")}.`,
    });
  }

  violations.push(
    ...staleRows({ entries: baseline.entries, found, policy: COMPOSED_EXPORTS_BASELINE, file }),
  );

  return violations;
}

export function lintComposedExportsBaseline(
  root: string,
  baselineReference?: string,
): { violations: ArchitectureViolation[] } {
  const file = baselineFile(root);
  const current = readBaseline({ policy: COMPOSED_EXPORTS_BASELINE, file });

  if (!baselineReference) return { violations: current.violations };

  const reference = readBaseline({
    policy: COMPOSED_EXPORTS_BASELINE,
    file: resolve(root, baselineReference),
  });

  // No merge-base copy is the one-time bootstrap the other ratchets already
  // treat as such. Comparing against nothing would call every row an addition.
  if (!reference.exists) return { violations: current.violations };

  return {
    violations: [
      ...current.violations,
      ...reference.violations,
      ...shrinkCheck({
        current: current.entries,
        reference: reference.entries,
        policy: COMPOSED_EXPORTS_BASELINE,
        file,
      }),
    ],
  };
}
