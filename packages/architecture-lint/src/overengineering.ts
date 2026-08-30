import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import type { ArchitectureViolation, ClassifiedPackage } from "./types";
import { walkFiles } from "./files";

/**
 * Three shapes that mean a design is paying for itself and getting nothing
 * back. Each is here because it was found in real code, not imagined:
 *
 *  - `layer-class`   a class most of whose methods forward to a method of the
 *                    same name on a collaborator. `DatasetApp` had 22 of 26,
 *                    `ApiKeyService` 30 of 31.
 *  - `conditional-type-depth`
 *                    a type alias built from conditional types nested past the
 *                    point anyone can evaluate by eye. `ConfigValue` in
 *                    `@langwatch/config` is seven deep, and exists to
 *                    re-derive a shape a plain interface already states — the
 *                    job Go does with a struct and an `env:"..."` tag.
 *  - `overload-by-literal`
 *                    an overload set whose members differ only by a boolean
 *                    literal in an options bag. `configUrl` and `configSecret`
 *                    each carry two signatures that say "optional: true" and
 *                    "optional: false"; two named functions, or one signature
 *                    returning `T | undefined`, say the same thing without the
 *                    reader having to diff two lines.
 *
 * The ratios and depths are deliberately generous. This policy is meant to
 * name the handful of places a reader would also call excessive, not to
 * referee taste.
 */

const MIN_METHODS_FOR_LAYER = 5;
const LAYER_DELEGATION_RATIO = 0.6;
const MAX_CONDITIONAL_TYPE_DEPTH = 3;
/**
 * How many distinct collaborators a mostly-delegating class may forward to
 * before it counts as composition rather than a layer. One receiver is a layer;
 * several is a class assembling specialists behind one published interface.
 */
const MAX_DELEGATION_RECEIVERS = 1;

/** The one facade the feature layout requires, and the routed repositories
 *  whose whole job is to pick a backend by the same verb. */
function isExemptFromLayerRule(path: string): boolean {
  return /\/app\/[^/]+\.app\.ts$/.test(path) || /\/repositories\/routed\//.test(path);
}

function sourceOf(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/**
 * A class member that behaves like a method: a method declaration, or a
 * property initialised with an arrow. Facades that bind `this` by field — or
 * that type each member off the interface they re-state — are written the
 * second way, and counting only the first missed two governance layers of 99
 * delegations each.
 */
type MethodLike = { name: string; body: ts.Node | undefined; declaration: ts.ClassElement };

function methodLike(member: ts.ClassElement): MethodLike | undefined {
  if (!member.name || !ts.isIdentifier(member.name)) return undefined;
  if (isPrivate(member)) return undefined;
  if (ts.isMethodDeclaration(member)) {
    return member.body
      ? { name: member.name.text, body: member.body, declaration: member }
      : undefined;
  }
  if (ts.isPropertyDeclaration(member) && member.initializer) {
    const initializer = member.initializer;
    return ts.isArrowFunction(initializer)
      ? { name: member.name.text, body: initializer.body, declaration: member }
      : undefined;
  }
  return undefined;
}

function isPrivate(member: ts.ClassElement): boolean {
  const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  return modifiers.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword,
  );
}

/**
 * The receiver of a same-name delegation, as a dotted path — `dependencies.dataset`
 * for `return this.dependencies.dataset.listRecords(input)` — or undefined when
 * the body is anything else.
 *
 * The body must be nothing but `this.<a>.<b>...<name>(...)`, where the final
 * property is the member's own name, whether written as a block with one
 * `return` or as an arrow's expression body. `await` in front counts; a guard,
 * a mapping or a second statement does not.
 */
function delegationReceiver(member: MethodLike): string | undefined {
  const { name, body } = member;
  if (!body) return undefined;

  let expression: ts.Expression;
  if (ts.isBlock(body)) {
    const statements = body.statements;
    if (statements.length !== 1) return undefined;
    const [only] = statements;
    if (!only || !ts.isReturnStatement(only) || !only.expression) return undefined;
    expression = only.expression;
  } else {
    expression = body as ts.Expression;
  }
  if (ts.isAwaitExpression(expression)) expression = expression.expression;
  if (!ts.isCallExpression(expression)) return undefined;

  const callee = expression.expression;
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (callee.name.text !== name) return undefined;

  // The receiver must be a `this.…` chain, not a free function or an import.
  const path: string[] = [];
  let receiver: ts.Expression = callee.expression;
  while (ts.isPropertyAccessExpression(receiver)) {
    path.unshift(receiver.name.text);
    receiver = receiver.expression;
  }
  if (receiver.kind !== ts.SyntaxKind.ThisKeyword) return undefined;
  return path.join(".");
}

function conditionalDepth(node: ts.TypeNode): number {
  if (!ts.isConditionalTypeNode(node)) return 0;
  return 1 + Math.max(conditionalDepth(node.trueType), conditionalDepth(node.falseType));
}

/** The literal-typed property names a signature's parameters mention. */
function booleanLiteralProperties(signature: ts.SignatureDeclaration): Map<string, boolean> {
  const found = new Map<string, boolean>();
  const visit = (node: ts.Node): void => {
    if (ts.isPropertySignature(node) && node.type && ts.isIdentifier(node.name)) {
      if (node.type.kind === ts.SyntaxKind.LiteralType) {
        const literal = (node.type as ts.LiteralTypeNode).literal;
        if (literal.kind === ts.SyntaxKind.TrueKeyword) found.set(node.name.text, true);
        if (literal.kind === ts.SyntaxKind.FalseKeyword) found.set(node.name.text, false);
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const parameter of signature.parameters) visit(parameter);
  return found;
}

function lintFile(root: string, path: string): ArchitectureViolation[] {
  const source = sourceOf(path);
  const file = relative(root, path).split("\\").join("/");
  const violations: ArchitectureViolation[] = [];

  const overloads = new Map<string, ts.SignatureDeclaration[]>();

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && !isExemptFromLayerRule(path)) {
      const methods = node.members
        .map(methodLike)
        .filter((member): member is MethodLike => member !== undefined);
      if (methods.length >= MIN_METHODS_FOR_LAYER) {
        const receivers = methods
          .map(delegationReceiver)
          .filter((receiver): receiver is string => receiver !== undefined);
        const ratio = receivers.length / methods.length;
        // Fanning out to several collaborators is COMPOSITION, and it is what a
        // class implementing a published contract from specialist services does:
        // `ApiKeyService` forwards 30 of 32 methods, but to seven different
        // fields, each the specialist for that verb. Deleting it would hand
        // every consumer seven objects instead of one. A pass-through LAYER
        // forwards everything to the same collaborator, and that is the one
        // this policy is looking for.
        const distinct = new Set(receivers);
        if (ratio >= LAYER_DELEGATION_RATIO && distinct.size <= MAX_DELEGATION_RECEIVERS) {
          violations.push({
            policy: "layer-class",
            file: path,
            line: lineOf(source, node),
            message: `${node.name?.text ?? "This class"} forwards ${receivers.length} of its ${methods.length} public methods to a method of the same name on \`this.${[...distinct].join("`, `this.")}\`.`,
            allowed:
              "Hold the collaborator at the caller and delete the class, or give it the rules that justify it. `app/<feature>.app.ts` and routed repositories are exempt.",
          });
        }
      }
    }

    if (ts.isTypeAliasDeclaration(node)) {
      const depth = conditionalDepth(node.type);
      if (depth > MAX_CONDITIONAL_TYPE_DEPTH) {
        violations.push({
          policy: "conditional-type-depth",
          file: path,
          line: lineOf(source, node),
          message: `Type ${node.name.text} nests ${depth} conditional types; the maximum is ${MAX_CONDITIONAL_TYPE_DEPTH}.`,
          allowed:
            "State the shape rather than deriving it. A type this deep is usually re-computing something a plain interface, a discriminated union, or a `satisfies` clause already says.",
        });
      }
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodSignature(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      const list = overloads.get(node.name.text) ?? [];
      list.push(node);
      overloads.set(node.name.text, list);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const [name, signatures] of overloads) {
    if (signatures.length < 2) continue;
    const seen = new Map<string, Set<boolean>>();
    for (const signature of signatures) {
      for (const [property, value] of booleanLiteralProperties(signature)) {
        const values = seen.get(property) ?? new Set<boolean>();
        values.add(value);
        seen.set(property, values);
      }
    }
    for (const [property, values] of seen) {
      if (values.size < 2) continue;
      const first = signatures[0];
      if (!first) continue;
      violations.push({
        policy: "overload-by-literal",
        file: path,
        line: lineOf(source, first),
        message: `${name} carries overloads that differ only by \`${property}: true\` versus \`${property}: false\`.`,
        allowed:
          "Give the two behaviours two names, or one signature whose return type already admits the absent case. An overload set the reader has to diff is not documentation.",
      });
      break;
    }
  }

  return violations;
}

const BASELINE_FILE = "overengineering-baseline.json";

/**
 * The sites that already existed when these three policies landed. The list
 * may shrink and may never grow: a new one fails the build, and an entry whose
 * site is gone fails too, so the file cannot quietly stop meaning anything.
 *
 * Keyed by `policy|file` rather than by line, because a finding survives the
 * edits above it and re-baselining on every line shift would defeat the point.
 */
function baselineKeys(root: string): Set<string> {
  const path = join(root, "packages/architecture-lint/src", BASELINE_FILE);
  if (!existsSync(path)) return new Set();
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const sites =
    typeof parsed === "object" && parsed !== null && "sites" in parsed
      ? (parsed as { sites?: unknown }).sites
      : undefined;
  return new Set(
    Array.isArray(sites) ? sites.filter((s): s is string => typeof s === "string") : [],
  );
}

export function collectOverengineering(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];
  // A package root can contain another package — `packages/enterprise` holds
  // every enterprise feature — so the same file is reachable twice. Lint each
  // one once, keyed by the path the walk found.
  const linted = new Set<string>();
  for (const pkg of packages) {
    if (pkg.kind === "tooling" || pkg.kind === "dev-runtime") continue;
    const files = walkFiles(
      pkg.root,
      (path) =>
        path.endsWith(".ts") &&
        !path.endsWith(".d.ts") &&
        !path.endsWith(".test.ts") &&
        !path.includes("/__tests__/") &&
        !path.includes("/generated/"),
    );
    for (const file of files) {
      if (linted.has(file)) continue;
      linted.add(file);
      violations.push(...lintFile(root, file));
    }
  }
  return violations;
}

function siteKey(root: string, violation: ArchitectureViolation): string {
  const file = relative(root, violation.file).split("\\").join("/");
  return `${violation.policy}|${file}`;
}

/** Every site, as the baseline file spells them. */
export function formatOverengineeringBaseline(
  root: string,
  packages: readonly ClassifiedPackage[],
): string {
  const sites = [...new Set(collectOverengineering(root, packages).map((v) => siteKey(root, v)))];
  return `${JSON.stringify({ version: 0, sites: sites.sort() }, null, 2)}\n`;
}

export function lintOverengineering(
  root: string,
  packages: readonly ClassifiedPackage[],
): ArchitectureViolation[] {
  const found = collectOverengineering(root, packages);
  const baseline = baselineKeys(root);
  if (baseline.size === 0) return found;

  const seen = new Set(found.map((violation) => siteKey(root, violation)));
  const violations = found.filter((violation) => !baseline.has(siteKey(root, violation)));

  for (const stale of [...baseline].filter((key) => !seen.has(key)).sort()) {
    const [policy, file] = stale.split("|");
    violations.push({
      policy: "overengineering-baseline",
      file: join(root, file ?? ""),
      message: `${policy} no longer fires here, so the baseline entry is stale.`,
      allowed: `Delete "${stale}" from packages/architecture-lint/src/${BASELINE_FILE}. The list may only shrink.`,
    });
  }

  return violations;
}
