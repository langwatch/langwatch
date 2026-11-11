// One module's facts, read syntactically: its `*Api` token and operations,
// its process class statics (dependencies, secrets, config), the stores its
// repositories require and the Prisma delegates it reaches by type.
import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  dependencyInitialisers,
  importedNames,
  locate,
  sourceFile,
  tokens,
} from "@langwatch/architecture-enforcer";
import ts from "typescript";

import {
  at,
  type At,
  definedObject,
  findDeclaration,
  type Folded,
  foldLeaf,
  type Reading,
  textOf,
  unwrap,
} from "./fold.mts";

const SKIPPED_DIRECTORIES = new Set(["dist", "node_modules", "__tests__", "__fixtures__"]);
const SOURCE_FILE = /\.[cm]?tsx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$|\.d\.ts$/;

export type Token = { name: string; type: string; module: string; at: At };
export type Operation = { name: string; params: string; returns: string; doc: string; at: At };
export type ApiInterface = {
  name: string;
  doc: string;
  extends: string[];
  operations: Operation[];
  at: At;
};
export type Peer = { name: string; token: string; module: string; resolved: boolean; at: At };
export type Leaf = Folded & { name: string; at: At };
export type Stores = { requires: string[]; resolved: boolean; at: At };
export type Delegate = { delegate: string; at: At };

/** Every source file under `directory`, tests, fixtures and build output skipped. */
export function sourceFiles({ directory }: { directory: string }): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) walk(path);
      const source = SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name);
      if (source && entry.isFile()) found.push(path);
    }
  };
  walk(directory);

  return found.toSorted();
}

function mentions({ file, pattern }: { file: string; pattern: RegExp }): boolean {
  return pattern.test(readFileSync(file, "utf8"));
}

function isStatic(node: ts.Node): boolean {
  return (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some(
    (item) => item.kind === ts.SyntaxKind.StaticKeyword,
  );
}

/** The initialiser of every `static <name>` class property in the file. */
function staticInitialisers({
  source,
  name,
}: {
  source: ts.SourceFile;
  name: string;
}): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    const matches =
      ts.isPropertyDeclaration(node) &&
      isStatic(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name;
    if (matches && node.initializer) found.push(node.initializer);

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** A token's module id: a literal, or a constant that holds one. */
function moduleIdOf({
  id,
  source,
  reading,
}: {
  id: ts.Expression;
  source: ts.SourceFile;
  reading: Reading;
}): string {
  if (ts.isStringLiteralLike(id)) return id.text;

  const found = ts.isIdentifier(id) ? findDeclaration({ name: id.text, source, reading }) : void 0;
  const value = found && ts.isExpression(found.node) ? unwrap(found.node) : void 0;

  return value && ts.isStringLiteralLike(value) ? value.text : "";
}

/** `moduleApi<XApi>()("x")` at `node`, read as a token, or nothing. */
function tokenAt({
  node,
  source,
  reading,
}: {
  node: ts.Node;
  source: ts.SourceFile;
  reading: Reading;
}): Token | undefined {
  if (!ts.isCallExpression(node) || !ts.isCallExpression(node.expression)) return void 0;

  const factory = node.expression;
  if (factory.expression.getText(source) !== "moduleApi") return void 0;

  const [id] = node.arguments;
  const holder = node.parent;
  const named = ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name);

  return {
    name: named ? holder.name.getText(source) : "",
    type: factory.typeArguments?.[0]?.getText(source) ?? "",
    module: id ? moduleIdOf({ id, source, reading }) : "",
    at: at({ node, source, reading }),
  };
}

/** `export const XApi = moduleApi<XApi>()("x")`: the token, its interface name and id. */
export function readTokens({ files, reading }: { files: string[]; reading: Reading }): Token[] {
  const found: Token[] = [];

  for (const file of files.filter((item) => mentions({ file: item, pattern: /\bmoduleApi\b/ }))) {
    const source = sourceFile({ file });
    const visit = (node: ts.Node): void => {
      const token = tokenAt({ node, source, reading });
      if (token) found.push(token);

      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return found;
}

function docOf(node: ts.Node): string {
  const [doc] = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
  const text = doc ? (ts.getTextOfJSDocComment(doc.comment) ?? "") : "";

  return text.replace(/\s+/g, " ").trim();
}

function signatureOf(member: ts.TypeElement): ts.SignatureDeclarationBase | undefined {
  if (ts.isMethodSignature(member)) return member;

  const type = ts.isPropertySignature(member) ? member.type : void 0;

  return type && ts.isFunctionTypeNode(type) ? type : void 0;
}

function operationOf({
  member,
  source,
  reading,
}: {
  member: ts.TypeElement;
  source: ts.SourceFile;
  reading: Reading;
}): Operation | undefined {
  const name = member.name;
  if (!name || !(ts.isIdentifier(name) || ts.isStringLiteral(name))) return void 0;

  const signature = signatureOf(member);
  const property = ts.isPropertySignature(member) ? member.type : void 0;
  const params = (signature?.parameters ?? []).map((parameter) => parameter.getText(source));
  const returns = signature?.type ?? property;

  return {
    name: name.text,
    params: params.join(", ").replace(/\s+/g, " "),
    returns: returns ? returns.getText(source).replace(/\s+/g, " ") : "void",
    doc: docOf(member),
    at: at({ node: member, source, reading }),
  };
}

/** The interface a token is typed by, with each member's printed signature. */
export function readApiInterface({
  token,
  reading,
}: {
  token: Token;
  reading: Reading;
}): ApiInterface | undefined {
  const holder = sourceFile({ file: join(reading.root, token.at.file) });
  const found = findDeclaration({ name: token.type, source: holder, reading });
  if (!found) return void 0;

  const { node, source } = found;
  const literal =
    ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type) ? node.type : void 0;
  const members = ts.isInterfaceDeclaration(node) ? node.members : literal?.members;
  const heritage = ts.isInterfaceDeclaration(node) ? (node.heritageClauses ?? []) : [];
  const extended = heritage.flatMap((clause) => clause.types.map((type) => type.getText(source)));
  const aliased = ts.isTypeAliasDeclaration(node) && !literal ? [node.type.getText(source)] : [];

  return {
    name: token.type,
    doc: docOf(node),
    extends: [...extended, ...aliased],
    operations: [...(members ?? [])].flatMap(
      (member) => operationOf({ member, source, reading }) ?? [],
    ),
    at: at({ node, source, reading }),
  };
}

function propertyNameOf(node: ts.Node): string {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isShorthandPropertyAssignment(current) || ts.isPropertyAssignment(current))
      return current.name.getText();
  }

  return node.getText();
}

type PeerLookup = {
  id: string;
  moduleOfToken: ReadonlyMap<string, string>;
  moduleOfPackage: (specifier: string) => string | undefined;
  reading: Reading;
};

/** The peers one dependency map names, added to `peers` by name. */
function mapPeers({
  expression,
  source,
  lookup,
  peers,
}: {
  expression: ts.Expression;
  source: ts.SourceFile;
  lookup: PeerLookup;
  peers: Map<string, Peer>;
}): void {
  const { reading } = lookup;
  const located = locate({ expression, source });
  if (!located) {
    const text = textOf({ node: expression, source });
    const where = at({ node: expression, source, reading });
    peers.set(text, { name: text, token: "", module: "", resolved: false, at: where });
    return;
  }

  for (const { token, source: holder } of tokens(located)) {
    const imported = importedNames(holder).get(token.text);
    const name = imported?.name ?? token.text;
    const viaPackage = imported ? lookup.moduleOfPackage(imported.specifier) : void 0;
    const module = lookup.moduleOfToken.get(name) || viaPackage;
    const peer = propertyNameOf(token);
    if (module === lookup.id || peers.has(peer)) continue;

    const where = at({ node: token, source: holder, reading });
    peers.set(peer, {
      name: peer,
      token: token.text,
      module: module ?? "",
      resolved: !!module,
      at: where,
    });
  }
}

/** `static dependencies`: each peer's name, token, and the module the token belongs to. */
export function readPeers({ files, ...lookup }: PeerLookup & { files: string[] }): Peer[] {
  const peers = new Map<string, Peer>();
  const declaring = /\bstatic\s+(?:readonly\s+)?dependencies\b/;

  for (const file of files.filter((item) => mentions({ file: item, pattern: declaring }))) {
    const source = sourceFile({ file });
    for (const expression of dependencyInitialisers(source))
      mapPeers({ expression, source, lookup, peers });
  }

  return [...peers.values()];
}

/** `static secrets = { key: someSecret }`, each leaf folded to its variable. */
export function readSecrets({ files, reading }: { files: string[]; reading: Reading }): Leaf[] {
  const leaves: Leaf[] = [];
  const declaring = /\bstatic\s+(?:readonly\s+)?secrets\b/;

  for (const file of files.filter((item) => mentions({ file: item, pattern: declaring }))) {
    const source = sourceFile({ file });

    for (const expression of staticInitialisers({ source, name: "secrets" })) {
      const located = locate({ expression, source });
      if (!located) {
        const where = at({ node: expression, source, reading });
        leaves.push({ ...foldLeaf({ expression, source, reading }), name: "", at: where });
        continue;
      }
      leaves.push(...objectLeaves({ literal: located.literal, source: located.source, reading }));
    }
  }

  return leaves;
}

type LeafScope = { source: ts.SourceFile; reading: Reading; prefix: string };

/** A spread's leaves, when it names an object the folder can find. */
function spreadLeaves({
  property,
  scope,
}: {
  property: ts.SpreadAssignment;
  scope: LeafScope;
}): Leaf[] | undefined {
  const { source, reading, prefix } = scope;
  const spread = unwrap(property.expression);
  if (!ts.isIdentifier(spread)) return void 0;

  const found = findDeclaration({ name: spread.text, source, reading });
  const literal = found && definedObject(found.node);

  return found && literal
    ? objectLeaves({ literal, source: found.source, reading, prefix })
    : void 0;
}

function propertyLeaves({
  property,
  scope,
}: {
  property: ts.ObjectLiteralElementLike;
  scope: LeafScope;
}): Leaf[] {
  const { source, reading, prefix } = scope;
  const where = at({ node: property, source, reading });
  const name = `${prefix}${property.name?.getText(source) ?? ""}`;
  const value = ts.isPropertyAssignment(property) ? unwrap(property.initializer) : void 0;

  if (value && ts.isObjectLiteralExpression(value))
    return objectLeaves({ literal: value, source, reading, prefix: `${name}.` });
  if (value) return [{ ...foldLeaf({ expression: value, source, reading }), name, at: where }];
  if (ts.isShorthandPropertyAssignment(property))
    return [{ ...foldLeaf({ expression: property.name, source, reading }), name, at: where }];

  const spread = ts.isSpreadAssignment(property) ? spreadLeaves({ property, scope }) : void 0;
  const text = textOf({ node: property, source });

  return spread ?? [{ value: "", text, resolved: false, name: text, at: where }];
}

/** Each leaf of an object of leaves: nested groups dotted, spreads followed. */
function objectLeaves({
  literal,
  source,
  reading,
  prefix = "",
}: {
  literal: ts.ObjectLiteralExpression;
  source: ts.SourceFile;
  reading: Reading;
  prefix?: string;
}): Leaf[] {
  const scope = { source, reading, prefix };

  return literal.properties.flatMap((property) => propertyLeaves({ property, scope }));
}

/** `static config = someConfig`: each leaf of the `Config.define` it names. */
export function readConfig({ files, reading }: { files: string[]; reading: Reading }): Leaf[] {
  const leaves: Leaf[] = [];
  const declaring = /\bstatic\s+(?:readonly\s+)?config\b/;

  for (const file of files.filter((item) => mentions({ file: item, pattern: declaring }))) {
    const source = sourceFile({ file });

    for (const expression of staticInitialisers({ source, name: "config" })) {
      const value = unwrap(expression);
      const found = ts.isIdentifier(value)
        ? findDeclaration({ name: value.text, source, reading })
        : { node: value, source };
      const literal = found && definedObject(found.node);

      if (found && literal) {
        leaves.push(...objectLeaves({ literal, source: found.source, reading }));
        continue;
      }
      const text = textOf({ node: value, source });
      const where = at({ node: expression, source, reading });
      leaves.push({ value: "", text, resolved: false, name: text, at: where });
    }
  }

  return leaves;
}

/** `static requires = ["prisma", …]` on a live-tier repository registry. */
export function readStores({ files, reading }: { files: string[]; reading: Reading }): Stores[] {
  const found: Stores[] = [];
  const declaring = /\bstatic\s+(?:readonly\s+)?requires\b/;
  const live = files.filter((file) => !file.includes("/memory/"));

  for (const file of live.filter((item) => mentions({ file: item, pattern: declaring }))) {
    const source = sourceFile({ file });

    for (const expression of staticInitialisers({ source, name: "requires" })) {
      const value = unwrap(expression);
      const elements = ts.isArrayLiteralExpression(value) ? [...value.elements] : [];
      const literals = elements.filter(ts.isStringLiteralLike).map((item) => item.text);
      const resolved = ts.isArrayLiteralExpression(value) && literals.length === elements.length;
      const requires = resolved ? literals : [textOf({ node: value, source })];
      found.push({ requires, resolved, at: at({ node: expression, source, reading }) });
    }
  }

  return found;
}

/** The string literals of a `Pick<PrismaClient, …>` at `node`, or none. */
function pickedDelegates({
  node,
  source,
}: {
  node: ts.Node;
  source: ts.SourceFile;
}): ts.StringLiteral[] {
  if (!ts.isTypeReferenceNode(node) || node.typeName.getText(source) !== "Pick") return [];

  const [client, picked] = node.typeArguments ?? [];
  if (client?.getText(source) !== "PrismaClient" || !picked) return [];

  const literals: ts.StringLiteral[] = [];
  const collect = (child: ts.Node): void => {
    if (ts.isLiteralTypeNode(child) && ts.isStringLiteral(child.literal))
      literals.push(child.literal);

    ts.forEachChild(child, collect);
  };
  collect(picked);

  return literals;
}

/** `Pick<PrismaClient, "a" | "b">`: the delegates a module reaches by type. */
export function readPrismaDelegates({
  files,
  reading,
}: {
  files: string[];
  reading: Reading;
}): Delegate[] {
  const found = new Map<string, Delegate>();

  for (const file of files.filter((item) =>
    mentions({ file: item, pattern: /\bPrismaClient\b/ }),
  )) {
    const source = sourceFile({ file });
    const visit = (node: ts.Node): void => {
      for (const literal of pickedDelegates({ node, source })) {
        const delegate = literal.text;
        if (!found.has(delegate))
          found.set(delegate, { delegate, at: at({ node: literal, source, reading }) });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  return [...found.values()].toSorted((left, right) => left.delegate.localeCompare(right.delegate));
}
