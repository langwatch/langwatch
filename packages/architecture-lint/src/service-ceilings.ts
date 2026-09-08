import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import type { ArchitectureViolation, ClassifiedPackage } from "./types.ts";
import { walkFiles } from "./files.ts";

const MAX_MODULE_LINES = 500;
const MAX_METHOD_LINES = 80;
const MAX_METHOD_STATEMENTS = 24;
const MAX_METHOD_COMPLEXITY = 24;
const MAX_SOURCE_LINE_LENGTH = 160;

type ServiceMeasurement = {
  moduleLines: number;
  methodLines: number;
  statements: number;
  complexity: number;
  lineLength: number;
};

const defaults: ServiceMeasurement = {
  moduleLines: MAX_MODULE_LINES,
  methodLines: MAX_METHOD_LINES,
  statements: MAX_METHOD_STATEMENTS,
  complexity: MAX_METHOD_COMPLEXITY,
  lineLength: MAX_SOURCE_LINE_LENGTH,
};

const COMPLEXITY_CONTROL_FLOW = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.CaseClause,
]);
const COMPLEXITY_SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

function isStrictService(path: string): boolean {
  return /\/server\/src\/services\/.+\.service\.ts$/.test(path);
}

const FUNCTION_LIKE_KINDS = new Set([
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
]);

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return FUNCTION_LIKE_KINDS.has(node.kind);
}

function complexityOf(node: ts.Node): number {
  let complexity = 1;
  const visit = (current: ts.Node): void => {
    if (isFunctionLike(current)) return;

    const isControlFlow = COMPLEXITY_CONTROL_FLOW.has(current.kind);
    const isShortCircuit =
      ts.isBinaryExpression(current) && COMPLEXITY_SHORT_CIRCUIT.has(current.operatorToken.kind);
    if (isControlFlow || isShortCircuit) {
      complexity += 1;
    }

    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);

  return complexity;
}

function measureService(path: string, source: string): ServiceMeasurement {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const measurement: ServiceMeasurement = {
    moduleLines: source.split("\n").length,
    methodLines: 0,
    statements: 0,
    complexity: 0,
    lineLength: Math.max(...source.split("\n").map((line) => line.length), 0),
  };
  const visit = (node: ts.Node): void => {
    const body = isFunctionLike(node) ? node.body : void 0;
    if (body !== void 0 && ts.isBlock(body)) {
      const methodLines =
        file.getLineAndCharacterOfPosition(body.end).line -
        file.getLineAndCharacterOfPosition(body.getStart(file)).line +
        1;
      measurement.methodLines = Math.max(measurement.methodLines, methodLines);
      measurement.statements = Math.max(measurement.statements, body.statements.length);
      measurement.complexity = Math.max(measurement.complexity, complexityOf(body));
    }

    ts.forEachChild(node, visit);
  };
  visit(file);

  return measurement;
}

function exceeds(measurement: ServiceMeasurement, ceiling: ServiceMeasurement): boolean {
  const exceedsSize =
    measurement.moduleLines > ceiling.moduleLines ||
    measurement.methodLines > ceiling.methodLines ||
    measurement.statements > ceiling.statements;
  const exceedsComplexity =
    measurement.complexity > ceiling.complexity || measurement.lineLength > ceiling.lineLength;

  return exceedsSize || exceedsComplexity;
}

function ceilingViolation(file: string): ArchitectureViolation | undefined {
  const measurement = measureService(file, readFileSync(file, "utf8"));

  if (!exceeds(measurement, defaults)) return void 0;

  return {
    policy: "service-ceilings",
    file,
    message: `Service module exceeds its ceiling (lines ${measurement.moduleLines}/${defaults.moduleLines}, longest method ${measurement.methodLines}/${defaults.methodLines}, statements ${measurement.statements}/${defaults.statements}, complexity ${measurement.complexity}/${defaults.complexity}, line length ${measurement.lineLength}/${defaults.lineLength}).`,
    allowed: "Split coherent private collaborators. Existing ceiling entries may only shrink.",
  };
}

/** Fast exact-path check for focused regression tests and targeted migration batches. */
export function lintServiceCeilingsFile(root: string, path: string): ArchitectureViolation[] {
  const violation = ceilingViolation(resolve(root, path));

  return violation ? [violation] : [];
}

/**
 * A service module stays inside the default ceiling. The per-file inventory
 * that once raised it reached zero and is gone.
 */
export function lintServiceCeilings(packages: ClassifiedPackage[]): ArchitectureViolation[] {
  return packages
    .filter((pkg) => pkg.kind === "server" && pkg.featureRoot)
    .flatMap((pkg) => walkFiles(pkg.root, isStrictService))
    .map(ceilingViolation)
    .filter((violation): violation is ArchitectureViolation => violation !== void 0);
}
