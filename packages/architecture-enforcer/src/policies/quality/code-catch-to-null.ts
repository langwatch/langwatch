import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Rule 7d of dev/docs/plans/platform-architecture-blocks.md (ADR-146): a catch that tests the
 * error's code and answers null turns a failure into a value. Shrink-only baseline, never read.
 */

export const CODE_CATCH_TO_NULL_POLICY = "code-catch-to-null";
export const CODE_CATCH_TO_NULL_RATCHET =
  "packages/architecture-enforcer/tests/baselines/code-catch-to-null.json";

const MODULE_TREES = ["modules", "enterprise/modules"] as const;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const NOT_PRODUCTION =
  /(?:^|\/)(?:__tests__|__fixtures__|__mocks__|fixtures|e2e|generated)\/|\.(?:test|spec|stories|fixture|generated)\.[cm]?[jt]sx?$/;

type Finding = { file: string; line: number };

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

function isNullish(node: ts.Node | undefined): boolean {
  if (!node) return false;
  const inner = ts.isParenthesizedExpression(node) ? node.expression : node;

  return (
    inner.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(inner) && inner.text === "undefined") ||
    ts.isVoidExpression(inner)
  );
}

function isStringLiteral(node: ts.Node): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function isCodeMember(node: ts.Node): boolean {
  return (
    (ts.isPropertyAccessExpression(node) && node.name.text === "code") ||
    (ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "code")
  );
}

/** `error.code === "x"`, in either order and with any equality operator. */
function comparesCodeToLiteral(node: ts.Node): boolean {
  if (!ts.isBinaryExpression(node)) return false;

  const equality = [
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
  ];

  return (
    equality.includes(node.operatorToken.kind) &&
    ((isCodeMember(node.left) && isStringLiteral(node.right)) ||
      (isCodeMember(node.right) && isStringLiteral(node.left)))
  );
}

/** `NotFoundError.is(error)` on the caught value. */
function isErrorGuardOf({ node, caught }: { node: ts.Node; caught: string | undefined }): boolean {
  if (!caught || !ts.isCallExpression(node)) return false;

  const callee = node.expression;
  const [argument] = node.arguments;

  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "is" &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text.endsWith("Error") &&
    argument !== undefined &&
    ts.isIdentifier(argument) &&
    argument.text === caught
  );
}

function decidesFromCode({ test, caught }: { test: ts.Node; caught: string | undefined }): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (comparesCodeToLiteral(node) || isErrorGuardOf({ node, caught })) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(test);

  return found;
}

/**
 * Whether `root` returns null or undefined by value (a bare `return;` leaves a void caller alone)
 * without crossing into a nested function.
 */
function returnsNullish(root: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || (node !== root && ts.isFunctionLike(node))) return;
    if (ts.isReturnStatement(node) && isNullish(node.expression)) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(root);

  return found;
}

function ifSwallowsCode({
  node,
  caught,
}: {
  node: ts.IfStatement;
  caught: string | undefined;
}): boolean {
  if (!decidesFromCode({ test: node.expression, caught })) return false;

  return returnsNullish(node.thenStatement);
}

function ternarySwallowsCode({
  node,
  caught,
}: {
  node: ts.ConditionalExpression;
  caught: string | undefined;
}): boolean {
  if (!decidesFromCode({ test: node.condition, caught })) return false;
  if (isNullish(node.whenTrue)) return true;

  return isNullish(node.whenFalse);
}

/** An `if` or ternary that tests the caught error's code and answers nullish for it. */
function swallowsCode({ node, caught }: { node: ts.Node; caught: string | undefined }): boolean {
  if (ts.isIfStatement(node)) return ifSwallowsCode({ node, caught });
  if (ts.isConditionalExpression(node)) return ternarySwallowsCode({ node, caught });

  return false;
}

/** The first node of a handler that tests the caught error's code and answers nullish for it. */
function swallowedCode({
  handler,
  caught,
}: {
  handler: ts.Node;
  caught: string | undefined;
}): ts.Node | undefined {
  let swallow: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (swallow || (node !== handler && ts.isFunctionLike(node))) return;
    if (swallowsCode({ node, caught })) {
      swallow = node;

      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(handler);

  return swallow;
}

function parameterName(node: ts.FunctionLikeDeclaration): string | undefined {
  const [first] = node.parameters;

  return first && ts.isIdentifier(first.name) ? first.name.text : void 0;
}

function isCatchCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "catch"
  );
}

function catchClauseSwallow(node: ts.CatchClause): ts.Node | undefined {
  const name = node.variableDeclaration?.name;
  const caught = name && ts.isIdentifier(name) ? name.text : void 0;

  return swallowedCode({ handler: node.block, caught });
}

function catchCallSwallow(node: ts.CallExpression): ts.Node | undefined {
  const [handler] = node.arguments;
  if (!handler) return void 0;
  if (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler)) return void 0;

  return swallowedCode({ handler: handler.body, caught: parameterName(handler) });
}

/** The swallow inside `node` when it is a catch clause or a `.catch(handler)` call. */
function catchSwallow(node: ts.Node): ts.Node | undefined {
  if (ts.isCatchClause(node)) return catchClauseSwallow(node);
  if (isCatchCall(node)) return catchCallSwallow(node);

  return void 0;
}

function fileFindings({ file, path }: { file: string; path: string }): Finding[] {
  if (!/\bcatch\b/.test(sourceText({ file }))) return [];

  const source = sourceFile({ file });
  const found: Finding[] = [];
  const report = (node: ts.Node): void => {
    found.push({
      file: path,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  };
  const visit = (node: ts.Node): void => {
    const swallow = catchSwallow(node);
    if (swallow) report(swallow);
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Each catch in module production code that turns a code-tested failure into null or undefined. */
export function collectCodeCatchToNull(snapshot: WorkspaceSnapshot): Finding[] {
  const { root } = snapshot;

  return MODULE_TREES.flatMap((directory) =>
    snapshot.files({
      directory: join(root, directory),
      accept: (file) => {
        const path = workspacePath({ root, file });

        return SOURCE_FILE.test(path) && !NOT_PRODUCTION.test(path);
      },
    }),
  ).flatMap((file) => fileFindings({ file, path: workspacePath({ root, file }) }));
}

/** The shrink-only key: the file. */
export function codeCatchToNullKey(finding: Finding): string {
  return finding.file;
}

export function lintCodeCatchToNull(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectCodeCatchToNull(snapshot).map((finding) => ({
    policy: CODE_CATCH_TO_NULL_POLICY,
    file: finding.file,
    line: finding.line,
    message:
      "This catch tests the error's code (or XError.is) and answers null: one failure becomes a missing value, and every caller repeats the swallow.",
    allowed: `Call the owner's find* and read [] instead of catching a get* into null (ADR-146). Each file's count in ${CODE_CATCH_TO_NULL_RATCHET} may fall, never rise.`,
  }));
}
