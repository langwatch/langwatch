import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";
import { walkFiles } from "./files";

const BASELINE_FILE = "service-ceilings-baseline.json";
const MAX_MODULE_LINES = 500;
const MAX_METHOD_LINES = 80;
const MAX_METHOD_STATEMENTS = 24;
const MAX_METHOD_COMPLEXITY = 24;
const MAX_SOURCE_LINE_LENGTH = 160;

type ServiceCeiling = {
  file: string;
  moduleLines: number;
  methodLines: number;
  statements: number;
  complexity: number;
  lineLength: number;
};

export type ServiceCeilingsBaselineCheck = {
  violations: ArchitectureViolation[];
  bootstrapped: boolean;
};

type ServiceMeasurement = {
  moduleLines: number;
  methodLines: number;
  statements: number;
  complexity: number;
  lineLength: number;
};

const ceilingFields = [
  "moduleLines",
  "methodLines",
  "statements",
  "complexity",
  "lineLength",
] as const;

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

const serviceCeilingSchema = z
  .object({
    file: z.string(),
    moduleLines: z.number().positive(),
    methodLines: z.number().positive(),
    statements: z.number().positive(),
    complexity: z.number().positive(),
    lineLength: z.number().positive(),
  })
  .strict();

const serviceCeilingsBaselineSchema = z
  .object({
    version: z.literal(0),
    services: z.array(serviceCeilingSchema),
  })
  .strict()
  .superRefine((baseline, context) => {
    const files = new Set<string>();

    for (const [index, service] of baseline.services.entries()) {
      if (files.has(service.file)) {
        context.addIssue({
          code: "custom",
          message: `duplicate service ${service.file}`,
          path: ["services", index, "file"],
        });
      }

      files.add(service.file);

      const previous = baseline.services[index - 1];
      const comparison = previous?.file.localeCompare(service.file);
      const ordered = comparison !== void 0 && comparison < 0;
      if (index > 0 && !ordered) {
        context.addIssue({
          code: "custom",
          message: "services must be sorted by file",
          path: ["services", index, "file"],
        });
      }
    }
  });

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

export function readServiceCeilingsBaselineFile(file: string): {
  exists: boolean;
  baseline: ServiceCeiling[];
  violations: ArchitectureViolation[];
} {
  if (!existsSync(file)) {
    return { exists: false, baseline: [], violations: [] };
  }

  let rawBaseline: unknown;
  try {
    rawBaseline = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      exists: true,
      baseline: [],
      violations: [
        {
          policy: "service-ceilings-baseline",
          file,
          message: `Service ceilings baseline must be valid: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = serviceCeilingsBaselineSchema.safeParse(rawBaseline);
  if (!result.success) {
    const reason = result.error.issues.at(0)?.message ?? "invalid baseline";

    return {
      exists: true,
      baseline: [],
      violations: [
        {
          policy: "service-ceilings-baseline",
          file,
          message: `Service ceilings baseline must be valid: ${reason}`,
        },
      ],
    };
  }

  return { exists: true, baseline: result.data.services, violations: [] };
}

function baselineFile(root: string): string {
  return join(root, "packages/architecture-lint/src", BASELINE_FILE);
}

/**
 * Validates the checked-in ceiling inventory against an explicit reference.
 *
 * The first rollout intentionally has no reference file. CI reports that
 * bootstrap rather than treating a missing file as an invisible successful
 * comparison. Once the baseline is on the target branch, every subsequent
 * run compares against it and accepts only deletions or lower ceilings.
 */
export function lintServiceCeilingsBaseline(
  root: string,
  baselineReference?: string,
): ServiceCeilingsBaselineCheck {
  const current = readServiceCeilingsBaselineFile(baselineFile(root));
  const violations = [...current.violations];
  if (baselineReference && !current.exists) {
    violations.push({
      policy: "service-ceilings-baseline",
      file: baselineFile(root),
      message: "Service ceilings baseline must be checked in before it can be compared.",
      allowed:
        "Commit the reviewed baseline once, then future merge-base checks may only shrink it.",
    });
  }

  if (!baselineReference) {
    return { violations, bootstrapped: false };
  }

  const reference = readServiceCeilingsBaselineFile(resolve(root, baselineReference));
  violations.push(...reference.violations);
  if (!reference.exists) {
    return { violations, bootstrapped: current.exists };
  }

  violations.push(
    ...compareServiceCeilingsBaselines(reference.baseline, current.baseline, baselineFile(root)),
  );

  return { violations, bootstrapped: false };
}

export function compareServiceCeilingsBaselines(
  reference: ServiceCeiling[],
  proposed: ServiceCeiling[],
  file: string,
): ArchitectureViolation[] {
  const referenceByFile = new Map(reference.map((entry) => [entry.file, entry]));
  const violations: ArchitectureViolation[] = [];
  for (const entry of proposed) {
    const previous = referenceByFile.get(entry.file);
    if (!previous) {
      violations.push({
        policy: "service-ceilings-baseline-growth",
        file,
        message: `Service ceilings baseline cannot add ${entry.file}.`,
        allowed: "Refactor the service below the default ceiling instead.",
      });
      continue;
    }

    const increased = ceilingFields.find((field) => entry[field] > previous[field]);
    if (increased) {
      violations.push({
        policy: "service-ceilings-baseline-growth",
        file,
        message: `Service ceilings baseline cannot increase ${entry.file}'s ${increased} ceiling.`,
        allowed: "Keep the prior ceiling or reduce it with the implementation.",
      });
    }
  }

  return violations;
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

function expectedCeiling(measurement: ServiceMeasurement): ServiceMeasurement {
  return {
    moduleLines: Math.max(defaults.moduleLines, measurement.moduleLines),
    methodLines: Math.max(defaults.methodLines, measurement.methodLines),
    statements: Math.max(defaults.statements, measurement.statements),
    complexity: Math.max(defaults.complexity, measurement.complexity),
    lineLength: Math.max(defaults.lineLength, measurement.lineLength),
  };
}

function matchesCeiling(entry: ServiceCeiling, expected: ServiceMeasurement): boolean {
  const matchesShape =
    entry.moduleLines === expected.moduleLines &&
    entry.methodLines === expected.methodLines &&
    entry.statements === expected.statements;
  const matchesComplexity =
    entry.complexity === expected.complexity && entry.lineLength === expected.lineLength;

  return matchesShape && matchesComplexity;
}

function lintServiceCeilingsFileAgainstBaseline(
  root: string,
  file: string,
  baseline: ServiceCeiling[],
): ArchitectureViolation[] {
  const relativeFile = relative(root, file).replaceAll("\\", "/");
  const measurement = measureService(file, readFileSync(file, "utf8"));
  const entry = new Map(baseline.map((candidate) => [candidate.file, candidate])).get(relativeFile);
  const ceiling = entry ?? defaults;
  const violations: ArchitectureViolation[] = [];
  if (exceeds(measurement, ceiling)) {
    violations.push({
      policy: "service-ceilings",
      file,
      message: `Service module exceeds its ceiling (lines ${measurement.moduleLines}/${ceiling.moduleLines}, longest method ${measurement.methodLines}/${ceiling.methodLines}, statements ${measurement.statements}/${ceiling.statements}, complexity ${measurement.complexity}/${ceiling.complexity}, line length ${measurement.lineLength}/${ceiling.lineLength}).`,
      allowed: "Split coherent private collaborators. Existing ceiling entries may only shrink.",
    });
  }

  const staleEntry = entry !== void 0 && !matchesCeiling(entry, expectedCeiling(measurement));
  if (staleEntry) {
    violations.push({
      policy: "service-ceilings-baseline",
      file,
      message: "Service ceilings baseline entry is stale or leaves growth headroom.",
      allowed:
        "Set every ceiling to max(default, current), or delete the entry when all values are default.",
    });
  }

  return violations;
}

/** Fast exact-path check for focused regression tests and targeted migration batches. */
export function lintServiceCeilingsFile(root: string, path: string): ArchitectureViolation[] {
  const baselineResult = readServiceCeilingsBaselineFile(baselineFile(root));

  return [
    ...baselineResult.violations,
    ...lintServiceCeilingsFileAgainstBaseline(root, resolve(root, path), baselineResult.baseline),
  ];
}

export function lintServiceCeilings(
  root: string,
  packages: ClassifiedPackage[],
  baselineReference?: string,
): ArchitectureViolation[] {
  const currentBaselineFile = baselineFile(root);
  const current = readServiceCeilingsBaselineFile(currentBaselineFile);
  const baselineCheck = lintServiceCeilingsBaseline(root, baselineReference);
  const baseline = current.baseline;
  const violations = [...baselineCheck.violations];
  const serviceFiles = packages
    .filter((pkg) => pkg.kind === "server" && pkg.featureRoot)
    .flatMap((pkg) => walkFiles(pkg.root, isStrictService));
  const seen = new Set<string>();

  for (const file of serviceFiles) {
    const relativeFile = relative(root, file).replaceAll("\\", "/");
    seen.add(relativeFile);
    violations.push(...lintServiceCeilingsFileAgainstBaseline(root, file, baseline));
  }

  for (const entry of baseline) {
    if (!seen.has(entry.file)) {
      violations.push({
        policy: "service-ceilings-baseline",
        file: join(root, "packages/architecture-lint/src", BASELINE_FILE),
        message: `Service ceilings baseline entry ${entry.file} no longer has a matching service module.`,
        allowed: "Delete stale entries; the baseline only shrinks.",
      });
    }
  }

  return violations;
}

export function formatServiceCeilingsBaseline(entries: ServiceCeiling[]): string {
  return `${JSON.stringify({ version: 0, services: entries }, null, 2)}\n`;
}

export function collectServiceCeilings(
  root: string,
  packages: ClassifiedPackage[],
): ServiceCeiling[] {
  return packages
    .filter((pkg) => pkg.kind === "server" && pkg.featureRoot)
    .flatMap((pkg) => walkFiles(pkg.root, isStrictService))
    .map((file) => {
      const measurement = measureService(file, readFileSync(file, "utf8"));

      return {
        file: relative(root, file).replaceAll("\\", "/"),
        ...expectedCeiling(measurement),
      };
    })
    .filter((entry) => !matchesCeiling(entry, defaults))
    .sort((a, b) => a.file.localeCompare(b.file));
}
