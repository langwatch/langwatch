import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  collectContractExports,
  collectForeignImports,
  type ForeignContractImport,
} from "./contract-export-use.ts";

/**
 * Rule 12c (ADR-182): a timeout, retry count, interval or TTL is the owner's tuning; another module
 * importing it freezes today's value. The owner hands over the result (a deadline, a policy, an
 * answer) through its Api; its own process and browser may import the number. Main runs at zero.
 */

export const CONTRACT_TUNING_CONSTANT_POLICY = "contract-tuning-constant";

const TUNING_NAME =
  /(?:_MS|_SECONDS|_MINUTES|_HOURS|_TTL|_DELAY|_RETRIES|_ATTEMPTS|_TIMEOUT|_INTERVAL)$|_BEFORE_/;

/** The expression past any `as`, `satisfies` and parentheses around it. */
function unwrapped(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression))
    return unwrapped(expression.expression);
  if (ts.isParenthesizedExpression(expression)) return unwrapped(expression.expression);

  return expression;
}

/** A name is a number to tune only when it holds one: not a string key, a map or a state value. */
function holdsNumber(declared: ts.Expression | undefined): boolean {
  if (declared === undefined) return false;

  const initializer = unwrapped(declared);

  return !(
    ts.isStringLiteralLike(initializer) ||
    ts.isObjectLiteralExpression(initializer) ||
    ts.isArrayLiteralExpression(initializer)
  );
}

export function collectTuningImports(snapshot: WorkspaceSnapshot): ForeignContractImport[] {
  const exports = collectContractExports({
    snapshot,
    accept: (candidate) => TUNING_NAME.test(candidate.name) && holdsNumber(candidate.initializer),
  });

  return collectForeignImports({ snapshot, exports });
}

export function lintContractTuningConstants(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectTuningImports(snapshot).map((finding) => ({
    policy: CONTRACT_TUNING_CONSTANT_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.export.name,
    message: `${finding.export.name} is ${finding.export.module}'s tuning number (${finding.export.file}); ${finding.importer} imports it and freezes today's value into its own behaviour.`,
    allowed: `Ask ${finding.export.module} through its Api for what the number decides (a deadline, a policy, an answer), or keep the constant out of the contract. See dev/docs/plans/platform-architecture-blocks.md rule 12c.`,
  }));
}
