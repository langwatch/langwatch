import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";
import { walkFiles } from "./files";

const BASELINE_FILE = "service-quality-baseline.json";
const MAX_MODULE_LINES = 500;
const MAX_METHOD_LINES = 80;
const MAX_METHOD_STATEMENTS = 24;
const MAX_METHOD_COMPLEXITY = 24;
const MAX_SOURCE_LINE_LENGTH = 160;

type ServiceQualityCeiling = {
  file: string;
  moduleLines: number;
  methodLines: number;
  statements: number;
  complexity: number;
  lineLength: number;
};

export type ServiceQualityBaselineCheck = {
  violations: ArchitectureViolation[];
  bootstrapped: boolean;
};

type ServiceQuality = {
  moduleLines: number;
  methodLines: number;
  statements: number;
  complexity: number;
  lineLength: number;
};

const qualityFields = [
  "moduleLines",
  "methodLines",
  "statements",
  "complexity",
  "lineLength",
] as const;

const defaults: ServiceQuality = {
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

const serviceQualityCeilingSchema = z
  .object({
    file: z.string(),
    moduleLines: z.number().positive(),
    methodLines: z.number().positive(),
    statements: z.number().positive(),
    complexity: z.number().positive(),
    lineLength: z.number().positive(),
  })
  .strict();

const serviceQualityBaselineSchema = z
  .object({
    version: z.literal(0),
    services: z.array(serviceQualityCeilingSchema),
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

function serviceQuality(path: string, source: string): ServiceQuality {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const quality: ServiceQuality = {
    moduleLines: source.split("\n").length,
    methodLines: 0,
    statements: 0,
    complexity: 0,
    lineLength: Math.max(...source.split("\n").map((line) => line.length), 0),
  };
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && node.body && ts.isBlock(node.body)) {
      const methodLines =
        file.getLineAndCharacterOfPosition(node.body.end).line -
        file.getLineAndCharacterOfPosition(node.body.getStart(file)).line +
        1;
      quality.methodLines = Math.max(quality.methodLines, methodLines);
      quality.statements = Math.max(quality.statements, node.body.statements.length);
      quality.complexity = Math.max(quality.complexity, complexityOf(node.body));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return quality;
}

export function readServiceQualityBaselineFile(file: string): {
  exists: boolean;
  baseline: ServiceQualityCeiling[];
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
          policy: "service-quality-baseline",
          file,
          message: `Service quality baseline must be valid: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = serviceQualityBaselineSchema.safeParse(rawBaseline);
  if (!result.success) {
    const reason = result.error.issues.at(0)?.message ?? "invalid baseline";

    return {
      exists: true,
      baseline: [],
      violations: [
        {
          policy: "service-quality-baseline",
          file,
          message: `Service quality baseline must be valid: ${reason}`,
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
export function lintServiceQualityBaseline(
  root: string,
  baselineReference?: string,
): ServiceQualityBaselineCheck {
  const current = readServiceQualityBaselineFile(baselineFile(root));
  const violations = [...current.violations];
  if (baselineReference && !current.exists) {
    violations.push({
      policy: "service-quality-baseline",
      file: baselineFile(root),
      message: "Service quality baseline must be checked in before it can be compared.",
      allowed:
        "Commit the reviewed baseline once, then future merge-base checks may only shrink it.",
    });
  }
  if (!baselineReference) {
    return { violations, bootstrapped: false };
  }

  const reference = readServiceQualityBaselineFile(resolve(root, baselineReference));
  violations.push(...reference.violations);
  if (!reference.exists) {
    return { violations, bootstrapped: current.exists };
  }
  violations.push(
    ...compareServiceQualityBaselines(reference.baseline, current.baseline, baselineFile(root)),
  );
  return { violations, bootstrapped: false };
}

export function compareServiceQualityBaselines(
  reference: ServiceQualityCeiling[],
  proposed: ServiceQualityCeiling[],
  file: string,
): ArchitectureViolation[] {
  const referenceByFile = new Map(reference.map((entry) => [entry.file, entry]));
  const violations: ArchitectureViolation[] = [];
  for (const entry of proposed) {
    const previous = referenceByFile.get(entry.file);
    if (!previous) {
      violations.push({
        policy: "service-quality-baseline-growth",
        file,
        message: `Service quality baseline cannot add ${entry.file}.`,
        allowed: "Refactor the service below the default ceiling instead.",
      });
      continue;
    }
    const increased = qualityFields.find((field) => entry[field] > previous[field]);
    if (increased) {
      violations.push({
        policy: "service-quality-baseline-growth",
        file,
        message: `Service quality baseline cannot increase ${entry.file}'s ${increased} ceiling.`,
        allowed: "Keep the prior ceiling or reduce it with the implementation.",
      });
    }
  }
  return violations;
}

function exceeds(quality: ServiceQuality, ceiling: ServiceQuality): boolean {
  const exceedsSize =
    quality.moduleLines > ceiling.moduleLines ||
    quality.methodLines > ceiling.methodLines ||
    quality.statements > ceiling.statements;
  const exceedsComplexity =
    quality.complexity > ceiling.complexity || quality.lineLength > ceiling.lineLength;
  return exceedsSize || exceedsComplexity;
}

function expectedCeiling(quality: ServiceQuality): ServiceQuality {
  return {
    moduleLines: Math.max(defaults.moduleLines, quality.moduleLines),
    methodLines: Math.max(defaults.methodLines, quality.methodLines),
    statements: Math.max(defaults.statements, quality.statements),
    complexity: Math.max(defaults.complexity, quality.complexity),
    lineLength: Math.max(defaults.lineLength, quality.lineLength),
  };
}

function matchesCeiling(entry: ServiceQualityCeiling, expected: ServiceQuality): boolean {
  const matchesShape =
    entry.moduleLines === expected.moduleLines &&
    entry.methodLines === expected.methodLines &&
    entry.statements === expected.statements;
  const matchesComplexity =
    entry.complexity === expected.complexity && entry.lineLength === expected.lineLength;
  return matchesShape && matchesComplexity;
}

function lintServiceQualityFileAgainstBaseline(
  root: string,
  file: string,
  baseline: ServiceQualityCeiling[],
): ArchitectureViolation[] {
  const relativeFile = relative(root, file).replaceAll("\\", "/");
  const quality = serviceQuality(file, readFileSync(file, "utf8"));
  const entry = new Map(baseline.map((candidate) => [candidate.file, candidate])).get(relativeFile);
  const ceiling = entry ?? defaults;
  const violations: ArchitectureViolation[] = [];
  if (exceeds(quality, ceiling)) {
    violations.push({
      policy: "service-quality",
      file,
      message: `Service module exceeds its quality ceiling (lines ${quality.moduleLines}/${ceiling.moduleLines}, longest method ${quality.methodLines}/${ceiling.methodLines}, statements ${quality.statements}/${ceiling.statements}, complexity ${quality.complexity}/${ceiling.complexity}, line length ${quality.lineLength}/${ceiling.lineLength}).`,
      allowed: "Split coherent private collaborators. Existing ceiling entries may only shrink.",
    });
  }
  if (entry && !matchesCeiling(entry, expectedCeiling(quality))) {
    violations.push({
      policy: "service-quality-baseline",
      file,
      message: "Service quality baseline entry is stale or leaves growth headroom.",
      allowed:
        "Set every ceiling to max(default, current), or delete the entry when all values are default.",
    });
  }
  return violations;
}

/** Fast exact-path check for focused regression tests and targeted migration batches. */
export function lintServiceQualityFile(root: string, path: string): ArchitectureViolation[] {
  const baselineResult = readServiceQualityBaselineFile(baselineFile(root));
  return [
    ...baselineResult.violations,
    ...lintServiceQualityFileAgainstBaseline(root, resolve(root, path), baselineResult.baseline),
  ];
}

export function lintServiceQuality(
  root: string,
  packages: ClassifiedPackage[],
  baselineReference?: string,
): ArchitectureViolation[] {
  const currentBaselineFile = baselineFile(root);
  const current = readServiceQualityBaselineFile(currentBaselineFile);
  const baselineCheck = lintServiceQualityBaseline(root, baselineReference);
  const baseline = current.baseline;
  const violations = [...baselineCheck.violations];
  const serviceFiles = packages
    .filter((pkg) => pkg.kind === "server" && pkg.featureRoot)
    .flatMap((pkg) => walkFiles(pkg.root, isStrictService));
  const seen = new Set<string>();

  for (const file of serviceFiles) {
    const relativeFile = relative(root, file).replaceAll("\\", "/");
    seen.add(relativeFile);
    violations.push(...lintServiceQualityFileAgainstBaseline(root, file, baseline));
  }

  for (const entry of baseline) {
    if (!seen.has(entry.file)) {
      violations.push({
        policy: "service-quality-baseline",
        file: join(root, "packages/architecture-lint/src", BASELINE_FILE),
        message: `Service quality baseline entry ${entry.file} no longer has a matching service module.`,
        allowed: "Delete stale entries; the baseline only shrinks.",
      });
    }
  }
  return violations;
}

export function formatServiceQualityBaseline(entries: ServiceQualityCeiling[]): string {
  return `${JSON.stringify({ version: 0, services: entries }, null, 2)}\n`;
}

export function collectServiceQualityCeilings(
  root: string,
  packages: ClassifiedPackage[],
): ServiceQualityCeiling[] {
  return packages
    .filter((pkg) => pkg.kind === "server" && pkg.featureRoot)
    .flatMap((pkg) => walkFiles(pkg.root, isStrictService))
    .map((file) => {
      const quality = serviceQuality(file, readFileSync(file, "utf8"));
      return {
        file: relative(root, file).replaceAll("\\", "/"),
        ...expectedCeiling(quality),
      };
    })
    .filter((entry) => !matchesCeiling(entry, defaults))
    .sort((a, b) => a.file.localeCompare(b.file));
}
