import { join, relative, sep } from "node:path";
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
} from "../baseline.ts";
import { walkFiles } from "../workspace/layout.ts";
import { sourceFile, sourceText } from "../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../workspace/snapshot.ts";
import type { ArchitectureViolation } from "../types.ts";

/**
 * Four counters the strict-layout drive tracks by hand
 * (`dev/scripts/shape-counters.sh`), turned into lints with a baseline that
 * may only shrink: a REST door with no runtime mount, a ports/adapters
 * folder the module shape retired, a composition root growing past its
 * measured size, and a `*-rest.mount.ts` file that does more than call
 * `runtime.mount(...)`.
 */

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

// --- rest-door-without-mount ------------------------------------------------

const REST_DOORS_FILE = "apps/api/src/app-rest/api-rest.doors.ts";
const REST_DOOR_BASELINE_FILE = "rest-door-without-mount-baseline.json";

export type RestDoorWithoutMountFinding = { family: string; line: number };

/** The `family` string literal of an `API_REST_DOORS` object entry that has no `mount` property. */
export function collectRestDoorWithoutMountFindings(root: string): RestDoorWithoutMountFinding[] {
  const file = join(root, REST_DOORS_FILE);
  if (!ts.sys.fileExists(file)) return [];

  const source = sourceFile({ file, kind: ts.ScriptKind.TS });
  const findings: RestDoorWithoutMountFinding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const familyProperty = node.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          ts.isIdentifier(property.name) &&
          property.name.text === "family" &&
          ts.isStringLiteralLike(property.initializer),
      );

      if (familyProperty) {
        const hasMount = node.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "mount",
        );

        if (!hasMount) {
          findings.push({
            family: (familyProperty.initializer as ts.StringLiteralLike).text,
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return findings.sort((left, right) => left.family.localeCompare(right.family));
}

export const REST_DOOR_WITHOUT_MOUNT_BASELINE: BaselinePolicy = {
  id: "rest-door-without-mount",
  file: REST_DOOR_BASELINE_FILE,
  label: "REST door without mount baseline",
  keyRule: "A key is the door's `family` name.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `REST door without mount baseline entry "${entry.key}" no longer matches a door and must be removed.`,
  }),
};

export function collectRestDoorWithoutMountBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectRestDoorWithoutMountFindings(root).map((finding) => finding.family);

  return collectBaseline({ policy: REST_DOOR_WITHOUT_MOUNT_BASELINE, found, previous });
}

export function lintRestDoorWithoutMount(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const file = baselinePath({ root, policy: REST_DOOR_WITHOUT_MOUNT_BASELINE });
  const baseline = readBaseline({ policy: REST_DOOR_WITHOUT_MOUNT_BASELINE, file });
  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: REST_DOOR_WITHOUT_MOUNT_BASELINE, file }),
  ];

  const findings = collectRestDoorWithoutMountFindings(root);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map((finding) => finding.family));

  for (const finding of findings) {
    if (baselined.has(finding.family)) continue;

    violations.push({
      policy: "rest-door-without-mount",
      file: join(root, REST_DOORS_FILE),
      line: finding.line,
      message: `The "${finding.family}" REST door has no \`mount\` field.`,
      allowed: "Declare the mount on the runtime.",
    });
  }

  violations.push(
    ...staleRows({ entries: baseline.entries, found, policy: REST_DOOR_WITHOUT_MOUNT_BASELINE, file }),
  );

  return violations;
}

// --- ports-and-adapters-folders ---------------------------------------------

const PORTS_ADAPTERS_BASELINE_FILE = "ports-and-adapters-folders-baseline.json";
const PORTS_ADAPTERS_PATH = /^(?:enterprise\/)?modules\/[^/]+\/server\/src\/(?:ports|adapters)\//;

function isPortsOrAdaptersFile(path: string): boolean {
  return /\.tsx?$/.test(path) && !/\.(?:test|spec)\.tsx?$/.test(path);
}

/** Every file under a `ports/` or `adapters/` folder the annotation shape retired. */
export function collectPortsAndAdaptersFoldersFindings(root: string): string[] {
  return walkFiles(root, (path) => isPortsOrAdaptersFile(path) && PORTS_ADAPTERS_PATH.test(workspacePath(root, path)))
    .map((path) => workspacePath(root, path))
    .sort();
}

export const PORTS_AND_ADAPTERS_FOLDERS_BASELINE: BaselinePolicy = {
  id: "ports-and-adapters-folders",
  file: PORTS_ADAPTERS_BASELINE_FILE,
  label: "Ports and adapters folders baseline",
  keyRule: "A key is the file's workspace-relative path.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Ports and adapters folders baseline entry "${entry.key}" no longer exists and must be removed.`,
  }),
};

export function collectPortsAndAdaptersFoldersBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectPortsAndAdaptersFoldersFindings(root);

  return collectBaseline({ policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE, found, previous });
}

export function lintPortsAndAdaptersFolders(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const file = baselinePath({ root, policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE });
  const baseline = readBaseline({ policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE, file });
  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE, file }),
  ];

  const findings = collectPortsAndAdaptersFoldersFindings(root);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings);

  for (const path of findings) {
    if (baselined.has(path)) continue;

    violations.push({
      policy: "ports-and-adapters-folders",
      file: join(root, path),
      message: `"${path}" lives under a ports/adapters folder, which the module shape retired.`,
      allowed:
        "Repositories go to repositories/<tier>/, technical ports fold into <F>Infrastructure, module-owned implementations go to services/.",
    });
  }

  violations.push(
    ...staleRows({ entries: baseline.entries, found, policy: PORTS_AND_ADAPTERS_FOLDERS_BASELINE, file }),
  );

  return violations;
}

// --- composition-root-may-only-shrink ---------------------------------------

const COMPOSITION_ROOT_BUDGET_FILE = "composition-root-line-budget.json";
const COMPOSITION_ROOTS = [
  "apps/api/src/app/api-production.composition.ts",
  "apps/worker/src/app/worker-production.composition.ts",
];

type CompositionRootBudget = { version: 0; budgets: Record<string, number> };

function budgetFile(root: string): string {
  return join(root, "packages/architecture-enforcer/src", COMPOSITION_ROOT_BUDGET_FILE);
}

function readCompositionRootBudget(root: string): CompositionRootBudget {
  const file = budgetFile(root);
  if (!ts.sys.fileExists(file)) return { version: 0, budgets: {} };

  return JSON.parse(ts.sys.readFile(file) ?? "{}") as CompositionRootBudget;
}

/** Non-empty lines: the same measure `pnpm typecheck`'s neighbouring shape checks use. */
function lineCount(file: string): number {
  return sourceText({ file })
    .split("\n")
    .filter((line) => line.trim() !== "").length;
}

export type CompositionRootBudgetFinding = { path: string; lines: number; budget: number };

/** Every composition root whose line count grew past its stored budget. */
export function collectCompositionRootBudgetFindings(root: string): CompositionRootBudgetFinding[] {
  const stored = readCompositionRootBudget(root);
  const findings: CompositionRootBudgetFinding[] = [];

  for (const path of COMPOSITION_ROOTS) {
    const file = join(root, path);
    if (!ts.sys.fileExists(file)) continue;

    const lines = lineCount(file);
    const budget = stored.budgets[path];

    if (budget !== undefined && lines > budget) {
      findings.push({ path, lines, budget });
    }
  }

  return findings;
}

/** The budget file this measurement would write: the smaller of the stored and the measured count, per path. */
export function collectCompositionRootBudget(root: string): CompositionRootBudget {
  const stored = readCompositionRootBudget(root);
  const budgets: Record<string, number> = { ...stored.budgets };

  for (const path of COMPOSITION_ROOTS) {
    const file = join(root, path);
    if (!ts.sys.fileExists(file)) continue;

    const lines = lineCount(file);
    const previous = budgets[path];
    budgets[path] = previous === undefined ? lines : Math.min(previous, lines);
  }

  return { version: 0, budgets };
}

export function lintCompositionRootMayOnlyShrink(
  snapshot: WorkspaceSnapshot,
): ArchitectureViolation[] {
  const { root } = snapshot;
  const stored = readCompositionRootBudget(root);
  const violations: ArchitectureViolation[] = [];

  if (Object.keys(stored.budgets).length === 0) {
    violations.push({
      policy: "composition-root-may-only-shrink-baseline",
      file: budgetFile(root),
      message: "Composition root line budget must be checked in before it can be compared.",
      allowed: "Commit the measured line counts once; the install mechanic replaces this file, add nothing to it.",
    });

    return violations;
  }

  for (const finding of collectCompositionRootBudgetFindings(root)) {
    violations.push({
      policy: "composition-root-may-only-shrink",
      file: join(root, finding.path),
      message: `${finding.path} is ${finding.lines} lines, past its measured budget of ${finding.budget}.`,
      allowed: "The install mechanic replaces this file, add nothing to it.",
    });
  }

  return violations;
}

// --- mount-file-is-one-call --------------------------------------------------

const MOUNT_FILE_BASELINE_FILE = "mount-file-is-one-call-baseline.json";
const MOUNT_FILE_ROOT = "apps/api/src/features";
const MOUNT_FILE_PATTERN = /-rest\.mount\.ts$/;

function isMountCall(expression: ts.Expression): boolean {
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === "mount"
  );
}

/** `return runtime.mount(...)` or `return [runtime.mount(...), ...]`, and nothing else. */
function isSingleMountReturn(body: ts.Block): boolean {
  if (body.statements.length !== 1) return false;

  const [statement] = body.statements;
  if (!statement || !ts.isReturnStatement(statement) || !statement.expression) return false;

  const returned = statement.expression;
  if (isMountCall(returned)) return true;

  return (
    ts.isArrayLiteralExpression(returned) &&
    returned.elements.every((element) => isMountCall(element))
  );
}

function functionBody(declaration: ts.FunctionDeclaration | ts.ArrowFunction): ts.Block | undefined {
  return declaration.body && ts.isBlock(declaration.body) ? declaration.body : undefined;
}

function isExported(modifiers: ts.NodeArray<ts.ModifierLike> | undefined): boolean {
  return modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

export type MountFileFinding = { path: string; reason: string };

/** A `*-rest.mount.ts` file that carries anything but imports and one exported `runtime.mount(...)` call. */
export function collectMountFileIsOneCallFindings(root: string): MountFileFinding[] {
  const files = walkFiles(
    join(root, MOUNT_FILE_ROOT),
    (path) => MOUNT_FILE_PATTERN.test(path) && !/__tests__/.test(path),
  );
  const findings: MountFileFinding[] = [];

  for (const file of files) {
    const source = sourceFile({ file, kind: ts.ScriptKind.TS });
    const path = workspacePath(root, file);
    const exportedFunctions: (ts.FunctionDeclaration | ts.ArrowFunction)[] = [];
    let otherDeclaration = false;

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) || ts.isImportEqualsDeclaration(statement)) continue;

      if (ts.isFunctionDeclaration(statement) && isExported(statement.modifiers)) {
        exportedFunctions.push(statement);
        continue;
      }

      if (ts.isVariableStatement(statement) && isExported(statement.modifiers)) {
        const onlyArrowFunctions = statement.declarationList.declarations.every(
          (declaration) => declaration.initializer && ts.isArrowFunction(declaration.initializer),
        );

        if (onlyArrowFunctions) {
          for (const declaration of statement.declarationList.declarations) {
            exportedFunctions.push(declaration.initializer as ts.ArrowFunction);
          }
          continue;
        }
      }

      otherDeclaration = true;
    }

    if (otherDeclaration || exportedFunctions.length > 1) {
      findings.push({
        path,
        reason: "carries a top-level declaration besides imports and one exported mount function",
      });
      continue;
    }

    const [only] = exportedFunctions;
    const body = only && functionBody(only);

    if (!body || !isSingleMountReturn(body)) {
      findings.push({ path, reason: "its exported function is not a single return of runtime.mount(...)" });
    }
  }

  return findings.sort((left, right) => left.path.localeCompare(right.path));
}

export const MOUNT_FILE_IS_ONE_CALL_BASELINE: BaselinePolicy = {
  id: "mount-file-is-one-call",
  file: MOUNT_FILE_BASELINE_FILE,
  label: "Mount file is one call baseline",
  keyRule: "A key is the mount file's workspace-relative path.",
  enforceExpiry: false,
  refuseEmpty: true,
  stale: (entry) => ({
    message: `Mount file is one call baseline entry "${entry.key}" no longer matches a mount file and must be removed.`,
  }),
};

export function collectMountFileIsOneCallBaseline({
  root,
  previous = [],
}: {
  root: string;
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectMountFileIsOneCallFindings(root).map((finding) => finding.path);

  return collectBaseline({ policy: MOUNT_FILE_IS_ONE_CALL_BASELINE, found, previous });
}

export function lintMountFileIsOneCall(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const file = baselinePath({ root, policy: MOUNT_FILE_IS_ONE_CALL_BASELINE });
  const baseline = readBaseline({ policy: MOUNT_FILE_IS_ONE_CALL_BASELINE, file });
  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: MOUNT_FILE_IS_ONE_CALL_BASELINE, file }),
  ];

  const findings = collectMountFileIsOneCallFindings(root);
  const baselined = liveKeys({ entries: baseline.entries });
  const found = new Set(findings.map((finding) => finding.path));

  for (const finding of findings) {
    if (baselined.has(finding.path)) continue;

    violations.push({
      policy: "mount-file-is-one-call",
      file: join(root, finding.path),
      message: `${finding.path} ${finding.reason}.`,
      allowed:
        "Behaviour belongs in the module App, credential and format concerns in the router declaration.",
    });
  }

  violations.push(
    ...staleRows({ entries: baseline.entries, found, policy: MOUNT_FILE_IS_ONE_CALL_BASELINE, file }),
  );

  return violations;
}
