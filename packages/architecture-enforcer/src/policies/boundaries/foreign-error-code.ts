import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { mentionMatcher, sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { GENERIC_ERROR_CODES } from "./error-code-single-owner.ts";

/**
 * Rule 2 (ADR-192): a module reacting to another module's handled error asks the owner's class
 * (`WidgetMissingError.is(error)`). A literal spelling the peer's code keeps comparing the old
 * spelling the day the owner renames or splits it, and nothing fails. Main runs at zero.
 */

export const FOREIGN_ERROR_CODE_POLICY = "foreign-error-code";

const MODULE_TREES = ["modules", "enterprise/modules"] as const;
const SCANNED_TREES = ["modules", "enterprise", "apps"] as const;
const FRAMEWORK_TREE = "packages";
const HANDLED_ERROR_PACKAGE = "packages/handled-error";
const GENERATED_CODES = "packages/handled-error/src/codes.generated.ts";
const GENERATED_TABLES = new Set(["goErrorCodes", "nodeErrorCodes"]);
const SOURCE_FILE = /\.[cm]?tsx?$/;
const TEST_FILE =
  /(?:__tests__|__fixtures__|__mocks__|\/fixtures\/|\/e2e\/|\/testing\/|\.(?:test|spec|stories|fixture|d)\.)/;
const GENERATED = /(?:^|\/)generated\/|\.generated\./;
const MENTIONS_STATIC_CODE = /\bstatic\s+(?:override\s+)?readonly\s+code\b/;
const MENTIONS_ANY_CODE = /\bsuper\(\s*["'`]|\breadonly\s+code\b/;
const COMPARISONS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
]);
const CODE_NAME = /(?:^c|C)ode$/;
const MEMBERSHIP_CALLS = new Set(["includes", "has", "indexOf", "some", "find", "findIndex"]);
/**
 * A helper named for matching an error's code (`hasCode`, `matchesErrorCode`, `errorChainHas`):
 * a code literal handed to it is a comparison. Name-based, so it leans to false negatives.
 */
const CODE_MATCHER_CALL =
  /^(?:has|is|matches)(?:Error)?Code$|(?:ChainHas|HasCode|MatchesCode|CodeIs)$/;
const COLLECTIONS = new Set(["Set", "ReadonlySet"]);

/** A handled error class a module contract declares, with its static code. */
export type OwnedErrorCode = {
  code: string;
  className: string;
  /** The owning module's directory, or the framework package's when `framework`. */
  module: string;
  /** The package to import the class from. */
  contract: string;
  file: string;
  framework: boolean;
};

/** How a literal uses a code: each is a question only the owner's class should answer. */
export type ForeignErrorCodeUse = "comparison" | "case" | "record-key" | "membership" | "alias";

/** A literal in a module or app that is not the code's owner, used to recognise the code. */
export type ForeignErrorCode = {
  file: string;
  line: number;
  code: string;
  use: ForeignErrorCodeUse;
  owners: readonly OwnedErrorCode[];
};

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

function lineOf({ source, node }: { source: ts.SourceFile; node: ts.Node }): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** The module directory a workspace path sits in, or undefined outside every module. */
export function moduleOfPath(path: string): string | undefined {
  for (const tree of MODULE_TREES) {
    const match = new RegExp(`^${tree}/([^/]+)/`).exec(path);
    if (match) return `${tree}/${match[1]}`;
  }

  return void 0;
}

type Wrapper = ts.AsExpression | ts.SatisfiesExpression | ts.ParenthesizedExpression;

/** A parenthesis or a type assertion, which passes its inner expression's value through. */
function isWrapper(node: ts.Node): node is Wrapper {
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return true;

  return ts.isParenthesizedExpression(node);
}

function unwrap(expression: ts.Expression): ts.Expression {
  return isWrapper(expression) ? unwrap(expression.expression) : expression;
}

function stringOf(node: ts.Node | undefined): string | undefined {
  if (node === undefined) return void 0;

  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : void 0;
}

function isStatic(member: ts.ClassElement): boolean {
  if (!ts.canHaveModifiers(member)) return false;

  return (ts.getModifiers(member) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword,
  );
}

/** The code a `static readonly code = "<code>"` member declares, or undefined. */
function staticCodeOf(member: ts.ClassElement): string | undefined {
  if (!ts.isPropertyDeclaration(member) || !isStatic(member)) return void 0;
  if (!ts.isIdentifier(member.name) || member.name.text !== "code") return void 0;

  return member.initializer && stringOf(unwrap(member.initializer));
}

/** Each `static readonly code = "<code>"` in the file, with its class. */
function staticCodes(source: ts.SourceFile): { code: string; className: string }[] {
  const found: { code: string; className: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node) && node.name) {
      const className = node.name.text;
      const codes = node.members
        .map((member) => staticCodeOf(member))
        .filter((code) => code !== undefined);
      for (const code of codes) found.push({ code, className });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** A `readonly code = "<code>"` instance field, or a `declare readonly code: "<a>" | "<b>"`. */
function fieldCodes(member: ts.ClassElement): string[] {
  if (!ts.isPropertyDeclaration(member) || !ts.isIdentifier(member.name)) return [];
  if (member.name.text !== "code") return [];

  const initial = member.initializer && stringOf(unwrap(member.initializer));
  const typed = (node: ts.TypeNode | undefined): string[] => {
    if (node && ts.isLiteralTypeNode(node))
      return [stringOf(node.literal)].filter((code) => code !== undefined);

    return node && ts.isUnionTypeNode(node) ? node.types.flatMap(typed) : [];
  };

  return [...(initial === undefined ? [] : [initial]), ...typed(member.type)];
}

/**
 * Every code a class in packages/handled-error declares: a static or instance `code` field, or
 * the first argument of `super(...)`. These are the platform's kinds of failure, no module's.
 */
function handledErrorPackageCodes(root: string): Set<string> {
  const directory = join(root, HANDLED_ERROR_PACKAGE, "src");
  if (!existsSync(directory)) return new Set();

  const codes = new Set<string>();
  const files = listFiles({ directory, accept: isScannedSource });
  for (const file of files) {
    if (!MENTIONS_ANY_CODE.test(sourceText({ file }))) continue;
    for (const code of declaredCodesOf(sourceFile({ file }))) codes.add(code);
  }

  return codes;
}

/** Non-test, non-generated TypeScript source. */
function isScannedSource(file: string): boolean {
  if (!SOURCE_FILE.test(file)) return false;

  return !TEST_FILE.test(file) && !GENERATED.test(file);
}

/** The code a `super("<code>", ...)` call passes, or undefined for any other node. */
function superCodeOf(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return void 0;
  const isSuper = node.expression.kind === ts.SyntaxKind.SuperKeyword;

  return isSuper ? stringOf(node.arguments[0]) : void 0;
}

/** Every code a file's classes declare: a static or instance `code` field, or a `super` code. */
function declaredCodesOf(source: ts.SourceFile): string[] {
  const codes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassLike(node)) codes.push(...node.members.flatMap((member) => fieldCodes(member)));
    const code = superCodeOf(node);
    if (code !== undefined) codes.push(code);
    ts.forEachChild(node, visit);
  };
  visit(source);

  return codes;
}

/** The keys of one generated code table's object literal, or none for any other declaration. */
function generatedTableKeys(declaration: ts.VariableDeclaration): string[] {
  if (!ts.isIdentifier(declaration.name)) return [];
  if (!GENERATED_TABLES.has(declaration.name.text)) return [];

  const table = declaration.initializer && unwrap(declaration.initializer);
  if (!table || !ts.isObjectLiteralExpression(table)) return [];

  return table.properties.flatMap((property) => {
    const name = property.name;
    if (!name) return [];

    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? [name.text] : [];
  });
}

/** The Go and Node services' codes, the keys of the generated code tables. */
export function generatedErrorCodes(root: string): Set<string> {
  const file = join(root, GENERATED_CODES);
  if (!existsSync(file)) return new Set();

  const statements = sourceFile({ file }).statements.filter(ts.isVariableStatement);

  return new Set(
    statements.flatMap((statement) =>
      statement.declarationList.declarations.flatMap((declaration) =>
        generatedTableKeys(declaration),
      ),
    ),
  );
}

type DeclaringPackage = {
  pkg: WorkspaceSnapshot["packages"][number];
  owner: string;
  framework: boolean;
};

/** A module's contract package, or a framework package under packages/ other than handled-error. */
function declaringPackages(snapshot: WorkspaceSnapshot): DeclaringPackage[] {
  return snapshot.packages.flatMap<DeclaringPackage>((pkg) => {
    const path = workspacePath({ root: snapshot.root, file: pkg.root });
    const module = pkg.kind === "contract" ? moduleOfPath(`${path}/`) : void 0;
    if (module !== undefined) return [{ pkg, owner: module, framework: false }];

    const framework = path.startsWith(`${FRAMEWORK_TREE}/`) && path !== HANDLED_ERROR_PACKAGE;

    return framework ? [{ pkg, owner: path, framework: true }] : [];
  });
}

/** Each static code a declaring package's classes declare, outside `notOwned`. */
function ownedCodesOf({
  snapshot,
  declaring,
  notOwned,
}: {
  snapshot: WorkspaceSnapshot;
  declaring: DeclaringPackage;
  notOwned: ReadonlySet<string>;
}): OwnedErrorCode[] {
  const { pkg, owner, framework } = declaring;
  const files = snapshot.files({ directory: join(pkg.root, "src"), accept: isScannedSource });

  return files
    .filter((file) => MENTIONS_STATIC_CODE.test(sourceText({ file })))
    .flatMap((file) =>
      staticCodes(sourceFile({ file }))
        .filter(({ code }) => !notOwned.has(code))
        .map(({ code, className }) => ({
          code,
          className,
          module: owner,
          contract: pkg.name,
          file: workspacePath({ root: snapshot.root, file }),
          framework,
        })),
    );
}

/**
 * Each module-owned code and its declaring classes: a module contract's class with a static `code`,
 * then any packages/ framework class declaring the same code. Generic codes, handled-error's own
 * and the services' generated codes belong to no module and are left out.
 */
export function collectOwnedErrorCodes(snapshot: WorkspaceSnapshot): Map<string, OwnedErrorCode[]> {
  const { root } = snapshot;
  const notOwned = new Set([
    ...GENERIC_ERROR_CODES,
    ...handledErrorPackageCodes(root),
    ...generatedErrorCodes(root),
  ]);
  const owned = new Map<string, OwnedErrorCode[]>();

  for (const declaring of declaringPackages(snapshot)) {
    for (const declaration of ownedCodesOf({ snapshot, declaring, notOwned }))
      owned.set(declaration.code, [...(owned.get(declaration.code) ?? []), declaration]);
  }

  // A code only a framework package declares is the platform's, not a module's.
  for (const [code, owners] of owned) {
    if (owners.every((owner) => owner.framework)) owned.delete(code);
    else
      owned.set(
        code,
        owners.toSorted(
          (left, right) => ownerRank({ owner: left, code }) - ownerRank({ owner: right, code }),
        ),
      );
  }

  return owned;
}

/**
 * Contract owners before framework packages, and among several contracts the module the code is
 * named after first: project_not_found lists the project contract's class before automation's.
 */
function ownerRank({ owner, code }: { owner: OwnedErrorCode; code: string }): number {
  const name = owner.module.split("/").at(-1) ?? "";
  const namedAfter = code.startsWith(`${name.replaceAll("-", "_")}_`);

  return (owner.framework ? 2 : 0) + (namedAfter ? 0 : 1);
}

/** The expression a node's value flows into, past parentheses and type assertions. */
function consumer(node: ts.Node): { child: ts.Node; parent: ts.Node } {
  let child = node;
  let parent = node.parent;
  while (parent && isWrapper(parent)) {
    child = parent;
    parent = parent.parent;
  }

  return { child, parent };
}

function calledMember(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;

  return void 0;
}

/** The name a call is made through: a plain function or a method. */
function calledName(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : calledMember(call);
}

/** Whether an expression is a membership test's collection: Set members or an includes receiver. */
function isMembershipCollection(expression: ts.Node): boolean {
  const { child, parent } = consumer(expression);
  if (!parent) return false;

  if (ts.isNewExpression(parent) && ts.isIdentifier(parent.expression))
    return COLLECTIONS.has(parent.expression.text);

  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === child &&
    MEMBERSHIP_CALLS.has(parent.name.text)
  );
}

/** The names a file tests for membership, so a list bound to one is a membership list. */
function membershipNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isMembershipCollection(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);

  return names;
}

/**
 * Whether an array literal is a membership list: a Set's members, an includes receiver, or the
 * value of a variable the same file tests for membership. A list of codes a contract exports as
 * its own union is a declaration, not a membership test, and is left to error-code-single-owner.
 */
function isMembershipList({
  array,
  tested,
}: {
  array: ts.ArrayLiteralExpression;
  tested: ReadonlySet<string>;
}): boolean {
  if (isMembershipCollection(array)) return true;

  const { child, parent } = consumer(array);

  return (
    parent !== undefined &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === child &&
    ts.isIdentifier(parent.name) &&
    tested.has(parent.name.text)
  );
}

/**
 * Whether a case label's switch reads a code: `code`, `kind` (its deprecated alias) or a name
 * ending in Code. A switch over another union's tag (`outcome.outcome`) shares a spelling, not a
 * meaning.
 */
function switchesOnCode(clause: ts.CaseClause): boolean {
  const name = discriminantName(unwrap(clause.parent.parent.expression));

  return name !== undefined && (CODE_NAME.test(name) || name === "kind");
}

/** The name a switch reads: an identifier, or a property access's member. */
function discriminantName(discriminant: ts.Expression): string | undefined {
  if (ts.isIdentifier(discriminant)) return discriminant.text;

  return ts.isPropertyAccessExpression(discriminant) ? discriminant.name.text : void 0;
}

type Flow = { node: ts.Node; child: ts.Node; parent: ts.Node };

/** A comparison, a code case label, or a record key; undefined for any other parent. */
function keyedUse({ node, child, parent }: Flow): ForeignErrorCodeUse | undefined {
  if (ts.isBinaryExpression(parent) && COMPARISONS.has(parent.operatorToken.kind))
    return "comparison";
  if (ts.isCaseClause(parent) && parent.expression === child)
    return switchesOnCode(parent) ? "case" : void 0;

  if (ts.isPropertyAssignment(parent) && parent.name === node) return "record-key";
  if (ts.isComputedPropertyName(parent) && ts.isPropertyAssignment(parent.parent))
    return "record-key";

  return void 0;
}

/** A code handed to a call: a code matcher compares, a membership method tests membership. */
function callUse(call: ts.CallExpression): ForeignErrorCodeUse | undefined {
  if (CODE_MATCHER_CALL.test(calledName(call) ?? "")) return "comparison";

  return MEMBERSHIP_CALLS.has(calledMember(call) ?? "") ? "membership" : void 0;
}

/** A const alias, a membership list member, or a call argument; undefined for any other parent. */
function valueUse({
  child,
  parent,
  tested,
}: Flow & { tested: ReadonlySet<string> }): ForeignErrorCodeUse | undefined {
  if (ts.isVariableDeclaration(parent) && parent.initializer === child) {
    return (parent.parent.flags & ts.NodeFlags.Const) !== 0 ? "alias" : void 0;
  }

  if (ts.isArrayLiteralExpression(parent))
    return isMembershipList({ array: parent, tested }) ? "membership" : void 0;

  if (ts.isCallExpression(parent) && parent.arguments.includes(child as ts.Expression))
    return callUse(parent);

  return void 0;
}

/** How a code-spelling node is used, or undefined when it is plain text. */
function useOf({
  node,
  tested,
}: {
  node: ts.Node;
  tested: ReadonlySet<string>;
}): ForeignErrorCodeUse | undefined {
  const { child, parent } = consumer(node);
  if (!parent) return void 0;

  return keyedUse({ node, child, parent }) ?? valueUse({ node, child, parent, tested });
}

/** The text a node spells when it can name a code: a string literal or an object key. */
function spelledCode(node: ts.Node): string | undefined {
  const text = stringOf(node);
  if (text !== undefined) return text;

  const isKey =
    ts.isIdentifier(node) && ts.isPropertyAssignment(node.parent) && node.parent.name === node;

  return isKey ? node.text : void 0;
}

/**
 * Every literal in non-test module and app source, outside the owning modules, that uses one of
 * the `codes` to recognise an error: a comparison, a case label, a record key or a membership list.
 */
export function collectCodeLiteralUses({
  snapshot,
  codes,
}: {
  snapshot: WorkspaceSnapshot;
  codes: ReadonlyMap<string, readonly OwnedErrorCode[]>;
}): ForeignErrorCode[] {
  const { root } = snapshot;
  if (codes.size === 0) return [];

  const mayName = mentionMatcher({ words: codes.keys() });
  const found: ForeignErrorCode[] = [];

  for (const tree of SCANNED_TREES) {
    const directory = join(root, tree);
    if (!existsSync(directory)) continue;

    const files = snapshot.files({ directory, accept: isScannedSource });
    for (const file of files.filter((candidate) => mayName(candidate)))
      found.push(...codeLiteralUsesOf({ file, path: workspacePath({ root, file }), codes }));
  }

  return found;
}

/** A node the literal scan never descends into: an import, a re-export or a type. */
function isSkippedNode(node: ts.Node): boolean {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return true;

  return ts.isTypeNode(node);
}

/** Every literal in one file that uses a code another module owns to recognise an error. */
function codeLiteralUsesOf({
  file,
  path,
  codes,
}: {
  file: string;
  path: string;
  codes: ReadonlyMap<string, readonly OwnedErrorCode[]>;
}): ForeignErrorCode[] {
  const module = moduleOfPath(path);
  const source = sourceFile({ file });
  const tested = membershipNames(source);
  const found: ForeignErrorCode[] = [];
  const visit = (node: ts.Node): void => {
    if (isSkippedNode(node)) return;

    const code = spelledCode(node);
    const owners = code === undefined ? undefined : codes.get(code);
    const foreign = owners !== undefined && !owners.some((owner) => owner.module === module);
    const use = foreign ? useOf({ node, tested }) : void 0;
    if (code !== undefined && owners !== undefined && use !== undefined)
      found.push({ file: path, line: lineOf({ source, node }), code, use, owners });

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

export function collectForeignErrorCodes(snapshot: WorkspaceSnapshot): ForeignErrorCode[] {
  return collectCodeLiteralUses({ snapshot, codes: collectOwnedErrorCodes(snapshot) });
}

function remedy(finding: ForeignErrorCode): string {
  const owner = finding.owners[0]!;
  const imports = finding.owners
    .map((item) => `${item.className} from ${item.contract}`)
    .join(" or ");
  if (finding.use === "record-key")
    return `Import ${imports} and key the record by [${owner.className}.code].`;

  return `Import ${imports} and use ${owner.className}.is(error).`;
}

export function lintForeignErrorCodes(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectForeignErrorCodes(snapshot).map((finding) => ({
    policy: FOREIGN_ERROR_CODE_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.code,
    message: `"${finding.code}" spells ${finding.owners
      .map((owner) => `${owner.className}'s code (${owner.module})`)
      .join(
        ", ",
      )} in a ${finding.use}; the literal goes stale the day the owner renames or splits it.`,
    allowed: `${remedy(finding)} See dev/docs/best_practices/error-handling.md and dev/docs/plans/platform-architecture-blocks.md rule 2.`,
  }));
}
