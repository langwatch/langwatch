import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { browserSourceFiles, lineOf, workspacePath } from "./raw-colour.ts";

/**
 * ARCHITECTURE.md §17, rule 15: browser code waits on what it needs (a ref, an observer, the
 * query's state), never on time; the four shapes are the TimingKind values below.
 * Shrink-only: tests/baselines/browser-timing-workaround.json counts per file and kind.
 */

export const TIMING_POLICY = "browser-timing-workaround";
export const TIMING_RATCHET =
  "packages/architecture-enforcer/tests/baselines/browser-timing-workaround.json";

export type TimingKind = "recursive-frame" | "deferred-frame" | "document-query" | "growing-reread";

type Finding = { file: string; line: number; kind: TimingKind };

const INSTEAD: Record<TimingKind, { message: string; allowed: string }> = {
  "recursive-frame": {
    message:
      "This frame callback schedules itself again until the page looks ready: it polls the DOM every frame instead of being told when it changed.",
    allowed:
      "Attach to the element through a ref callback, or watch it with a ResizeObserver or MutationObserver, and act when it fires.",
  },
  "deferred-frame": {
    message:
      "This frame callback only defers to a further frame or a zero timeout: it guesses how long rendering takes.",
    allowed:
      "Run the work from the effect or ref callback of the element it waits for (or `flushSync` the state it needs), so it happens after that render and not after a guessed delay.",
  },
  "document-query": {
    message:
      "This `document` query reaches outside the component tree for an element, so it breaks when the markup moves and runs before the element exists.",
    allowed:
      "Hold the element in a ref (or a ref callback) owned by the component that renders it, and pass it down or expose it from a hook.",
  },
  "growing-reread": {
    message:
      "This timer re-reads a query after growing delays, guessing when the data will have settled.",
    allowed:
      "Let the data say it changed: subscribe to its stream, or give the query a `refetchInterval` that stops on the settled state.",
  },
};

const FRAME = "requestAnimationFrame";
const DOCUMENT_QUERY = new Set(["querySelector", "querySelectorAll", "getElementById"]);
const MODULE_SOURCE = /^(?:enterprise\/)?modules\//;
/** A query-cache re-read: what a growing timer chain repeats. */
const REREAD = /\.(?:invalidate|invalidateQueries|refetch|refetchQueries|fetchQuery)\(/;

function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;

  return void 0;
}

/** The name a function is known by: its own, its variable's, its property's or its method's. */
function functionName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return declaredName(node);
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return void 0;

  let holder: ts.Node = node.parent;
  // `useCallback(() => ..., [])` names the callback by the variable holding the hook's result.
  if (ts.isCallExpression(holder) && holder.arguments[0] === node) holder = holder.parent;

  return holderName(holder) ?? assignedName(holder);
}

function declaredName(node: ts.FunctionDeclaration | ts.MethodDeclaration): string | undefined {
  return node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : void 0;
}

/** `const f = ...`, `{ f: ... }` or a class field `f = ...`. */
function holderName(holder: ts.Node): string | undefined {
  const isNamedHolder =
    ts.isVariableDeclaration(holder) ||
    ts.isPropertyAssignment(holder) ||
    ts.isPropertyDeclaration(holder);
  if (!isNamedHolder) return void 0;

  return ts.isIdentifier(holder.name) ? holder.name.text : void 0;
}

/** `f = ...` or `this.f = ...`. */
function assignedName(holder: ts.Node): string | undefined {
  if (!ts.isBinaryExpression(holder)) return void 0;
  if (holder.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return void 0;
  const target = holder.left;
  if (ts.isIdentifier(target)) return target.text;

  return ts.isPropertyAccessExpression(target) ? target.name.text : void 0;
}

/** The nearest function a node is written in; for a call, never the callback handed to it. */
function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }

  return void 0;
}

/** A counter, a frame budget or a settle window: the marks of a wait, not of an animation. */
const WAIT_MARK =
  /\b(?:attempts?|tries|retries|frames|framesLeft|MAX_[A-Z_]*(?:FRAMES|ATTEMPTS|POLLS?|TRIES))\b|settle|\b(?:querySelector(?:All)?|getElementById)\(/i;

/** `if (!element) requestAnimationFrame(poll)`: scheduling again because something is missing. */
function isUnderMissingGuard({ call, owner }: { call: ts.Node; owner: ts.Node }): boolean {
  for (
    let current = call.parent;
    current !== undefined && current !== owner;
    current = current.parent
  ) {
    if (ts.isIfStatement(current) && ts.isPrefixUnaryExpression(current.expression)) {
      return current.expression.operator === ts.SyntaxKind.ExclamationToken;
    }
  }

  return false;
}

/**
 * A frame callback that schedules the function it is written in, and waits rather than animates:
 * it counts attempts or frames, settles, queries the DOM, or reschedules because something is
 * missing. A loop that only draws or eases is an animation and is not a finding.
 */
function isRecursiveWait({
  call,
  callback,
  source,
}: {
  call: ts.CallExpression;
  callback: ts.Expression;
  source: ts.SourceFile;
}): boolean {
  const owner = enclosingFunction(call);
  const name = owner === undefined ? undefined : functionName(owner);
  if (owner === undefined || name === undefined || !scheduledNames(callback).includes(name))
    return false;

  const scope = enclosingFunction(owner) ?? source;

  return (
    WAIT_MARK.test(owner.getText(source)) ||
    /settle/i.test(scope.getText(source)) ||
    isUnderMissingGuard({ call, owner })
  );
}

/** `f`, `this.f`, or `() => f(...)`: the function a frame callback runs. */
function scheduledNames(callback: ts.Expression): string[] {
  if (ts.isIdentifier(callback)) return [callback.text];
  if (
    ts.isPropertyAccessExpression(callback) &&
    callback.expression.kind === ts.SyntaxKind.ThisKeyword
  )
    return [callback.name.text];
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return [];

  const called: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
      called.push(node.expression.text);
    if (!ts.isFunctionLike(node) || node === callback) ts.forEachChild(node, visit);
  };
  visit(callback);

  return called;
}

/** A concise body, or the expression of a block's single expression statement. */
function onlyExpression(body: ts.ConciseBody): ts.Expression | undefined {
  if (!ts.isBlock(body)) return body;
  const [first] = body.statements;
  if (body.statements.length !== 1 || first === undefined) return void 0;

  return ts.isExpressionStatement(first) ? first.expression : void 0;
}

/** A frame whose only work is another frame or a zero timeout. */
function isDeferredFrame(callback: ts.Expression): boolean {
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false;
  const only = onlyExpression(callback.body);
  if (only === undefined || !ts.isCallExpression(only)) return false;

  const name = calleeName(only);
  if (name === FRAME) return true;
  const delay = only.arguments[1];

  return (
    name === "setTimeout" &&
    (delay === undefined || (ts.isNumericLiteral(delay) && delay.text === "0"))
  );
}

/** A delay read from an increasing list, `[500, 1_000, 2_000]`, or doubled, `delay * 2`. */
function isGrowingDelay({
  delay,
  source,
}: {
  delay: ts.Expression | undefined;
  source: ts.SourceFile;
}): boolean {
  if (delay === undefined) return false;
  if (ts.isBinaryExpression(delay) && delay.operatorToken.kind === ts.SyntaxKind.AsteriskToken)
    return true;
  if (ts.isElementAccessExpression(delay))
    return isIncreasingList({ name: delay.expression.getText(source), source });
  if (!ts.isIdentifier(delay)) return false;

  const name = delay.text;
  let growing = false;
  const visit = (node: ts.Node): void => {
    const value = initializerOf({ node, name });
    if (value !== undefined && ts.isElementAccessExpression(value))
      growing ||= isIncreasingList({ name: value.expression.getText(source), source });
    if (isMultipliedAssignment({ node, name, source })) growing = true;
    ts.forEachChild(node, visit);
  };
  visit(source);

  return growing;
}

/** The initializer when `node` declares the variable `name`. */
function initializerOf({ node, name }: { node: ts.Node; name: string }): ts.Expression | undefined {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return void 0;

  return node.name.text === name ? node.initializer : void 0;
}

/** `name *= x` or `name = ... * ...`. */
function isMultipliedAssignment({
  node,
  name,
  source,
}: {
  node: ts.Node;
  name: string;
  source: ts.SourceFile;
}): boolean {
  if (!ts.isBinaryExpression(node) || !ts.isIdentifier(node.left)) return false;
  if (node.left.text !== name) return false;
  const operator = node.operatorToken.kind;
  if (operator === ts.SyntaxKind.AsteriskEqualsToken) return true;

  return operator === ts.SyntaxKind.EqualsToken && /\*/.test(node.right.getText(source));
}

/** Whether a literal list of three or more numbers rises; undefined when it is not such a list. */
function increasingList(initializer: ts.Expression): boolean | undefined {
  let value = initializer;
  while (ts.isAsExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;
  if (!ts.isArrayLiteralExpression(value) || value.elements.length < 3) return void 0;
  const numbers = value.elements.map((element) =>
    ts.isNumericLiteral(element) ? Number(element.text.replaceAll("_", "")) : Number.NaN,
  );

  return numbers.every((number, index) => index === 0 || number > numbers[index - 1]!);
}

function isIncreasingList({ name, source }: { name: string; source: ts.SourceFile }): boolean {
  let increasing = false;
  const visit = (node: ts.Node): void => {
    const initializer = initializerOf({ node, name });
    if (initializer !== undefined) {
      const list = increasingList(initializer);
      if (list !== undefined) increasing = list;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return increasing;
}

/** Head markup, not a rendered component: `meta[name="x-country"]`, an injected `style`. */
const HEAD_SELECTOR = /^(?:meta|link|script|style|head|html|body)\b/;

/**
 * `document.querySelector(...)` reaching for a rendered element. Reading head markup is not one,
 * and nor is the guard of an idempotent injection, `if (document.getElementById(id)) return;`
 * (alone or inside an `||` chain).
 */
function isElementReach(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
  if (callee.expression.text !== "document") return false;
  const [selector] = call.arguments;
  if (
    selector !== undefined &&
    ts.isStringLiteralLike(selector) &&
    HEAD_SELECTOR.test(selector.text)
  )
    return false;
  let condition: ts.Node = call;
  while (
    ts.isBinaryExpression(condition.parent) &&
    condition.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken
  )
    condition = condition.parent;
  const guard = condition.parent;

  return !(
    ts.isIfStatement(guard) &&
    guard.expression === condition &&
    ts.isReturnStatement(guard.thenStatement)
  );
}

/** Every timing workaround one call is: a frame, a `document` query or a growing re-read. */
function callKinds({
  call,
  path,
  source,
}: {
  call: ts.CallExpression;
  path: string;
  source: ts.SourceFile;
}): TimingKind[] {
  const name = calleeName(call);
  const [callback, delay] = call.arguments;
  const kinds: TimingKind[] = [];
  const frame = name === FRAME ? frameKind({ call, callback, source }) : void 0;
  if (frame !== undefined) kinds.push(frame);
  if (isModuleDocumentQuery({ call, name, path })) kinds.push("document-query");
  if (name === "setTimeout" && isGrowingReread({ callback, delay, source }))
    kinds.push("growing-reread");

  return kinds;
}

function frameKind({
  call,
  callback,
  source,
}: {
  call: ts.CallExpression;
  callback: ts.Expression | undefined;
  source: ts.SourceFile;
}): TimingKind | undefined {
  if (callback === undefined) return void 0;
  if (isRecursiveWait({ call, callback, source })) return "recursive-frame";

  return isDeferredFrame(callback) ? "deferred-frame" : void 0;
}

function isModuleDocumentQuery({
  call,
  name,
  path,
}: {
  call: ts.CallExpression;
  name: string | undefined;
  path: string;
}): boolean {
  if (name === undefined || !DOCUMENT_QUERY.has(name)) return false;

  return MODULE_SOURCE.test(path) && isElementReach(call);
}

function isGrowingReread({
  callback,
  delay,
  source,
}: {
  callback: ts.Expression | undefined;
  delay: ts.Expression | undefined;
  source: ts.SourceFile;
}): boolean {
  if (callback === undefined || !REREAD.test(callback.getText(source))) return false;

  return isGrowingDelay({ delay, source });
}

function timingSites({ file, path }: { file: string; path: string }): Finding[] {
  const text = sourceText({ file });
  if (!/requestAnimationFrame|document\.|setTimeout/.test(text)) return [];

  const source = sourceFile({ file });
  const found: Finding[] = [];
  const record = (kind: TimingKind, node: ts.Node): void => {
    found.push({ file: path, line: lineOf({ source, at: node.getStart(source) }), kind });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      for (const kind of callKinds({ call: node, path, source })) record(kind, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Each timing workaround in browser code, one finding per call. */
export function collectTimingWorkarounds(snapshot: WorkspaceSnapshot): Finding[] {
  const { root } = snapshot;

  return browserSourceFiles(snapshot).flatMap((file) =>
    timingSites({ file, path: workspacePath({ root, file }) }),
  );
}

/** The shrink-only key: the file and the kind. */
export function timingKey(finding: Finding): string {
  return `${finding.file}|${finding.kind}`;
}

export function lintBrowserTimingWorkarounds(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectTimingWorkarounds(snapshot).map((finding) => ({
    policy: TIMING_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.kind,
    message: INSTEAD[finding.kind].message,
    allowed: `${INSTEAD[finding.kind].allowed} Each file's count per kind in ${TIMING_RATCHET} may fall, never rise: lower it in the change that removes a use.`,
  }));
}
