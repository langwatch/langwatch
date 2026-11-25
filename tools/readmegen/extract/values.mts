// Folding values and reading builder chains for the readmegen extractor: a
// literal one hop away (a constant, a template, arithmetic, an object member)
// folds to its value; a fluent `a(...).b(...).c(...)` call reads as links.
import ts from "typescript";

import { at, type At, findDeclaration, type Found, type Reading, textOf, unwrap } from "./fold.mts";

const MAX_DEPTH = 12;

/** A folded scalar: `value` when resolved, else the source text it stands for. */
export type Scalar = { value: string; text: string; resolved: boolean; file: string };

/** One `.name(args)` call of a fluent chain, the root call included. */
export type Link = { name: string; args: readonly ts.Expression[]; call: ts.CallExpression };

/** A chain as read, with the condition of an early `if (…) return x.build()`. */
export type Chain = { links: (Link & { gated: boolean })[]; split: string; splitAt?: At };

type Scope = { source: ts.SourceFile; reading: Reading };

function isFunctionLike(node: ts.Node): node is ts.SignatureDeclaration {
  return ts.isFunctionLike(node);
}

/** `name` as declared in the nearest enclosing block, else at the top of the file. */
export function scopedDeclaration({
  name,
  from,
  source,
  reading,
}: Scope & { name: string; from: ts.Node }): Found | undefined {
  for (let node = from.parent; node && !ts.isSourceFile(node); node = node.parent) {
    if (isFunctionLike(node) && node.parameters.some((item) => item.name.getText() === name))
      return void 0;
    if (!ts.isBlock(node)) continue;

    for (const statement of node.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
        return { node: statement, source };
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
          return declaration.initializer ? { node: declaration.initializer, source } : void 0;
      }
    }
  }

  return findDeclaration({ name, source, reading });
}

function member({
  object,
  name,
}: {
  object: ts.ObjectLiteralExpression;
  name: string;
}): ts.Expression | undefined {
  const property = object.properties.find((item) => item.name?.getText() === name);
  if (property && ts.isPropertyAssignment(property)) return property.initializer;

  return property && ts.isShorthandPropertyAssignment(property) ? property.name : void 0;
}

function returnedFrom(node: ts.Node): ts.Expression | undefined {
  if (!isFunctionLike(node)) return void 0;

  const body = (node as ts.FunctionLikeDeclarationBase).body;
  if (!body) return void 0;
  if (!ts.isBlock(body)) return body;

  const returned = body.statements.filter(ts.isReturnStatement).at(-1);

  return returned?.expression;
}

/** The object literal an expression evaluates to, following names, members and calls. */
export function objectOf({
  expression,
  source,
  reading,
  depth = 0,
}: Scope & { expression: ts.Expression; depth?: number }): Found | undefined {
  if (depth > MAX_DEPTH) return void 0;

  const value = unwrap(expression);
  const next = (node: ts.Expression, from: ts.SourceFile): Found | undefined =>
    objectOf({ expression: node, source: from, reading, depth: depth + 1 });
  if (ts.isObjectLiteralExpression(value)) return { node: value, source };
  if (ts.isIdentifier(value)) {
    const found = scopedDeclaration({ name: value.text, from: value, source, reading });

    return found && ts.isExpression(found.node) ? next(found.node, found.source) : void 0;
  }
  if (ts.isPropertyAccessExpression(value)) {
    const owner = next(value.expression, source);
    const initialiser =
      owner && member({ object: owner.node as ts.ObjectLiteralExpression, name: value.name.text });

    return owner && initialiser ? next(initialiser, owner.source) : void 0;
  }
  if (!ts.isCallExpression(value)) return void 0;

  const [argument] = value.arguments;
  if (argument && ts.isObjectLiteralExpression(unwrap(argument))) return next(argument, source);

  const callee = unwrap(value.expression);
  const found = ts.isIdentifier(callee)
    ? scopedDeclaration({ name: callee.text, from: callee, source, reading })
    : void 0;
  const returned = found ? returnedFrom(found.node) : void 0;

  return found && returned ? next(returned, found.source) : void 0;
}

/** Property `name` of the object an expression evaluates to. */
export function propertyOf({
  expression,
  name,
  source,
  reading,
}: Scope & { expression: ts.Expression; name: string }): Found | undefined {
  const owner = objectOf({ expression, source, reading });
  const value = owner && member({ object: owner.node as ts.ObjectLiteralExpression, name });

  return owner && value ? { node: value, source: owner.source } : void 0;
}

type Raw = { value: string | number; file: string } | undefined;

function arithmetic(operator: ts.SyntaxKind, left: Raw, right: Raw): Raw {
  if (!left || !right) return void 0;
  const file = right.file || left.file;
  const numbers = typeof left.value === "number" && typeof right.value === "number";
  if (operator === ts.SyntaxKind.PlusToken && !numbers)
    return { value: String(left.value) + String(right.value), file };
  if (typeof left.value !== "number" || typeof right.value !== "number") return void 0;
  if (operator === ts.SyntaxKind.PlusToken) return { value: left.value + right.value, file };
  if (operator === ts.SyntaxKind.AsteriskToken) return { value: left.value * right.value, file };
  if (operator === ts.SyntaxKind.MinusToken) return { value: left.value - right.value, file };
  if (operator === ts.SyntaxKind.SlashToken) return { value: left.value / right.value, file };

  return void 0;
}

function raw({
  expression,
  source,
  reading,
  depth,
}: Scope & { expression: ts.Expression; depth: number }): Raw {
  if (depth > MAX_DEPTH) return void 0;

  const value = unwrap(expression);
  const step = (node: ts.Expression, from: ts.SourceFile = source): Raw =>
    raw({ expression: node, source: from, reading, depth: depth + 1 });
  if (ts.isStringLiteralLike(value)) return { value: value.text, file: source.fileName };
  if (ts.isNumericLiteral(value))
    return { value: Number(value.text.replaceAll("_", "")), file: "" };
  if (ts.isBinaryExpression(value))
    return arithmetic(value.operatorToken.kind, step(value.left), step(value.right));
  if (ts.isTemplateExpression(value)) {
    let text = value.head.text;
    for (const span of value.templateSpans) {
      const part = step(span.expression);
      if (!part) return void 0;
      text += String(part.value) + span.literal.text;
    }

    return { value: text, file: source.fileName };
  }
  if (ts.isIdentifier(value)) {
    const found = scopedDeclaration({ name: value.text, from: value, source, reading });

    return found && ts.isExpression(found.node) ? step(found.node, found.source) : void 0;
  }
  if (ts.isPropertyAccessExpression(value)) {
    const found = propertyOf({
      expression: value.expression,
      name: value.name.text,
      source,
      reading,
    });

    return found && ts.isExpression(found.node) ? step(found.node, found.source) : void 0;
  }

  return void 0;
}

/** An expression folded to a string or number, or its text when it cannot be. */
export function fold({
  expression,
  source,
  reading,
}: Scope & { expression: ts.Expression }): Scalar {
  const text = textOf({ node: expression, source });
  const folded = raw({ expression, source, reading, depth: 0 });
  if (!folded) return { value: "", text, resolved: false, file: "" };

  return { value: String(folded.value), text, resolved: true, file: folded.file };
}

/** The scalar elements of an array literal, each folded. */
export function foldList({
  expression,
  source,
  reading,
}: Scope & { expression: ts.Expression }): Scalar[] {
  const value = unwrap(expression);
  if (!ts.isArrayLiteralExpression(value)) return [fold({ expression, source, reading })];

  return value.elements.map((element) => fold({ expression: element, source, reading }));
}

/** Calls whose callee reads exactly `callee` (e.g. `definePipeline`), in source order. */
export function callsNamed({
  source,
  callee,
}: {
  source: ts.SourceFile;
  callee: RegExp;
}): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && callee.test(node.expression.getText(source))) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

function linkAbove(node: ts.Expression): Link | undefined {
  const access = node.parent;
  if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== node)
    return void 0;
  const call = access.parent;
  if (!call || !ts.isCallExpression(call) || call.expression !== access) return void 0;

  return { name: access.name.text, args: call.arguments, call };
}

function climb(start: ts.Expression): { links: Link[]; top: ts.Expression } {
  const links: Link[] = [];
  let node = start;
  for (let link = linkAbove(node); link; link = linkAbove(node)) {
    links.push(link);
    node = link.call;
  }

  return { links, top: node };
}

/** `if (cond) return x.build();`: the condition, when `chain` is that lone build. */
function splitCondition({
  links,
  source,
}: {
  links: Link[];
  source: ts.SourceFile;
}): ts.IfStatement | undefined {
  if (links.length !== 1 || links[0]?.name !== "build") return void 0;

  let node: ts.Node | undefined = links[0].call.parent;
  if (node && ts.isReturnStatement(node)) node = node.parent;
  if (node && ts.isBlock(node) && node.statements.length === 1) node = node.parent;

  return node && ts.isIfStatement(node) && node.getText(source).length > 0 ? node : void 0;
}

/** The chain from a root call, followed through the `const` it is stored in. */
export function readChain({ root, source, reading }: Scope & { root: ts.CallExpression }): Chain {
  const callee = root.expression.getText(source);
  const first = climb(root);
  const links: Chain["links"] = [{ name: callee, args: root.arguments, call: root, gated: false }];
  for (const link of first.links) links.push({ ...link, gated: false });

  const holder = first.top.parent;
  if (!holder || !ts.isVariableDeclaration(holder) || !ts.isIdentifier(holder.name))
    return { links, split: "" };

  const name = holder.name.text;
  const container = holder.parent.parent.parent;
  let split: ts.IfStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name && node.pos > holder.end) {
      const next = climb(node);
      const condition = splitCondition({ links: next.links, source });
      if (condition) split ??= condition;
      else
        for (const link of next.links)
          links.push({ ...link, gated: Boolean(split) && node.pos > split.end });
    }
    ts.forEachChild(node, visit);
  };
  if (container) ts.forEachChild(container, visit);

  return split
    ? {
        links,
        split: textOf({ node: split.expression, source }),
        splitAt: at({ node: split, source, reading }),
      }
    : { links, split: "" };
}
