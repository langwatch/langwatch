// Browser-half facts for the readmegen extractor: the `defineBrowserModule(...)`
// chain (screens, drawers, lends, hosts, the tRPC contracts it calls) and the
// application's route table, read syntactically.
import { sourceFile } from "@langwatch/architecture-enforcer";
import ts from "typescript";

import { at, type At, type Reading, textOf, unwrap } from "./fold.mts";
import { fold, foldList, objectOf, readChain, type Scalar, scopedDeclaration } from "./values.mts";

export type Screen = {
  key: string;
  path: Scalar | null;
  within: Scalar | null;
  label: Scalar | null;
  requires: Scalar | null;
  flags: Scalar[];
  at: At;
};
export type Drawer = { name: Scalar; opens: string; token: string; at: At };
export type Lend = { token: string; at: At };
export type BrowserFacts = {
  name: Scalar;
  exportName: string;
  doc: string;
  at: At;
  screens: Screen[];
  drawers: Drawer[];
  lends: Lend[];
  hosts: Scalar[];
  capabilities: string[];
  api: string;
  contracts: Scalar[];
  config: string[];
};
export type UiRoute = { page: string; path: string };

type Scope = { source: ts.SourceFile; reading: Reading };

function properties({ expression, ...scope }: Scope & { expression: ts.Expression | undefined }): {
  key: string;
  value: ts.Expression;
  source: ts.SourceFile;
}[] {
  const found = expression ? objectOf({ expression, ...scope }) : void 0;
  if (!found || !ts.isObjectLiteralExpression(found.node)) return [];

  const object = found.node;

  return object.properties.flatMap((item) => {
    if (!ts.isPropertyAssignment(item)) return [];
    const key = ts.isStringLiteral(item.name) ? item.name.text : item.name.getText(found.source);

    return [{ key, value: item.initializer, source: found.source }];
  });
}

function optional({
  expression,
  ...scope
}: Scope & { expression: ts.Expression | undefined }): Scalar | null {
  if (!expression) return null;
  if (unwrap(expression).kind === ts.SyntaxKind.NullKeyword)
    return { value: "none", text: "null", resolved: true, file: "" };

  return fold({ expression, ...scope });
}

/** The module file a `load: () => import("./x.tsx")` opens, relative to the root. */
function loadedFile({ value, ...scope }: Scope & { value: ts.Expression }): string {
  const found = objectOf({ expression: value, ...scope });
  const load =
    found &&
    properties({
      expression: found.node as ts.Expression,
      source: found.source,
      reading: scope.reading,
    }).find((item) => item.key === "load");
  const text = load ? load.value.getText(load.source) : "";
  const specifier = /import\(\s*["']([^"']+)["']\s*\)/.exec(text)?.[1];
  if (!specifier || !load) return "";
  if (!specifier.startsWith(".")) return specifier;

  const base = load.source.fileName.split("/").slice(0, -1).join("/");
  const joined = `${base}/${specifier}`.split("/");
  const parts: string[] = [];
  for (const part of joined) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }

  return parts.join("/").slice(scope.reading.root.length + 1);
}

/** The first argument of the call a name is declared by, e.g. `owner.drawer<P>("name")`. */
function declaredKey({ expression, ...scope }: Scope & { expression: ts.Expression }): Scalar {
  const value = unwrap(expression);
  const text = textOf({ node: value, source: scope.source });
  if (!ts.isIdentifier(value)) return fold({ expression: value, ...scope });

  const found = scopedDeclaration({ name: value.text, from: value, ...scope });
  let node = found && ts.isExpression(found.node) ? unwrap(found.node) : void 0;
  while (node && ts.isCallExpression(node) && ts.isCallExpression(unwrap(node.expression)))
    node = unwrap(node.expression);
  if (node && ts.isPropertyAccessExpression(node) && ts.isCallExpression(node.expression))
    node = node.expression;
  if (found && node && ts.isCallExpression(node) && node.arguments[0])
    return fold({ expression: node.arguments[0], source: found.source, reading: scope.reading });

  return { value: "", text, resolved: false, file: "" };
}

/** The namespace of a `defineTrpcContract("ns")...` chain a name holds. */
function contractNamespace({
  expression,
  ...scope
}: Scope & { expression: ts.Expression }): Scalar {
  const value = unwrap(expression);
  const text = textOf({ node: value, source: scope.source });
  const found = ts.isIdentifier(value)
    ? scopedDeclaration({ name: value.text, from: value, ...scope })
    : void 0;
  let node: ts.Node | undefined = found?.node;
  while (node && ts.isCallExpression(node)) {
    const callee = unwrap(node.expression);
    if (
      ts.isIdentifier(callee) &&
      callee.text === "defineTrpcContract" &&
      node.arguments[0] &&
      found
    )
      return fold({ expression: node.arguments[0], source: found.source, reading: scope.reading });
    node = ts.isPropertyAccessExpression(callee) ? unwrap(callee.expression) : void 0;
  }

  return { value: "", text, resolved: false, file: "" };
}

function docOf({ node, source }: { node: ts.Node; source: ts.SourceFile }): string {
  const statement = node.parent?.parent?.parent;
  const own = statement ? ts.getJSDocCommentsAndTags(statement).filter(ts.isJSDoc)[0] : void 0;
  const comment = own?.comment ?? leadingDoc(source);

  return typeof comment === "string" ? comment.replace(/\s+/g, " ").trim() : "";
}

function leadingDoc(source: ts.SourceFile): string {
  const match = /^\s*\/\*\*([\s\S]*?)\*\//.exec(source.text);

  return match?.[1] ? match[1].replace(/^\s*\* ?/gm, "") : "";
}

function screensOf({
  expression,
  ...scope
}: Scope & { expression: ts.Expression | undefined }): Screen[] {
  return properties({ expression, ...scope }).map(({ key, value, source }) => {
    const local = { source, reading: scope.reading };
    const fields = new Map(
      properties({ expression: value, ...local }).map((item) => [item.key, item]),
    );
    const field = (name: string): Scalar | null => {
      const item = fields.get(name);

      return item
        ? optional({ expression: item.value, source: item.source, reading: scope.reading })
        : null;
    };
    const flags = fields.get("flags");

    return {
      key,
      path: field("path"),
      within: field("within"),
      label: field("label"),
      requires: field("requires"),
      flags: flags
        ? foldList({ expression: flags.value, source: flags.source, reading: scope.reading })
        : [],
      at: at({ node: value, ...local }),
    };
  });
}

/** Every `defineBrowserModule(...)` chain in the half's source, the first one read. */
export function readBrowser({
  files,
  reading,
}: {
  files: string[];
  reading: Reading;
}): BrowserFacts | null {
  for (const file of files) {
    const source = sourceFile({ file });
    if (!source.text.includes("defineBrowserModule(")) continue;
    let root: ts.CallExpression | undefined;
    const visit = (node: ts.Node): void => {
      if (
        !root &&
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "defineBrowserModule"
      )
        root = node;
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (root) return browserChain({ root, source, reading });
  }

  return null;
}

function browserChain({ root, ...scope }: Scope & { root: ts.CallExpression }): BrowserFacts {
  let holder: ts.Node = root;
  while (
    holder.parent &&
    !ts.isVariableDeclaration(holder.parent) &&
    !ts.isSourceFile(holder.parent)
  )
    holder = holder.parent;
  const declaration =
    holder.parent && ts.isVariableDeclaration(holder.parent) ? holder.parent : void 0;
  const facts: BrowserFacts = {
    name: root.arguments[0]
      ? fold({ expression: root.arguments[0], ...scope })
      : { value: "", text: "", resolved: false, file: "" },
    exportName: declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : "",
    doc: declaration ? docOf({ node: declaration, source: scope.source }) : "",
    at: at({ node: root, ...scope }),
    screens: [],
    drawers: [],
    lends: [],
    hosts: [],
    capabilities: [],
    api: "",
    contracts: [],
    config: [],
  };
  for (const link of readChain({ root, ...scope }).links) {
    const [first, second] = link.args;
    const where = at({ node: link.call, ...scope });
    if (link.name === "withScreens")
      facts.screens.push(...screensOf({ expression: first, ...scope }));
    if (link.name === "withDrawers")
      for (const item of properties({ expression: first, ...scope }))
        facts.drawers.push({
          name: { value: item.key, text: item.key, resolved: true, file: "" },
          opens: loadedFile({ value: item.value, source: item.source, reading: scope.reading }),
          token: "",
          at: at({ node: item.value, source: item.source, reading: scope.reading }),
        });
    if (link.name === "drawer" && first && second)
      facts.drawers.push({
        name: declaredKey({ expression: first, ...scope }),
        opens: loadedFile({ value: second, ...scope }),
        token: textOf({ node: first, source: scope.source }),
        at: where,
      });
    if (link.name === "lends" && first)
      facts.lends.push({ token: textOf({ node: first, source: scope.source }), at: where });
    if (link.name === "withHosts") {
      const requires = properties({ expression: first, ...scope }).find(
        (item) => item.key === "requires",
      );
      if (requires)
        facts.hosts.push(
          ...foldList({
            expression: requires.value,
            source: requires.source,
            reading: scope.reading,
          }),
        );
    }
    if (link.name === "withCapabilities")
      facts.capabilities.push(
        ...properties({ expression: first, ...scope }).map((item) => item.key),
      );
    if (link.name === "withConfig")
      facts.config.push(...properties({ expression: first, ...scope }).map((item) => item.key));
    if (link.name === "withApi" && first) {
      facts.api = textOf({ node: first, source: scope.source });
      const contracts = properties({ expression: second, ...scope }).find(
        (item) => item.key === "contracts",
      );
      const list = contracts ? unwrap(contracts.value) : void 0;
      if (contracts && list && ts.isArrayLiteralExpression(list))
        for (const element of list.elements)
          facts.contracts.push(
            contractNamespace({
              expression: element,
              source: contracts.source,
              reading: scope.reading,
            }),
          );
    }
  }

  return facts;
}

/** Page key -> URL from `uiRouteTable`, a child's relative path joined to its parent's. */
export function readUiRoutes({ file, reading }: { file: string; reading: Reading }): UiRoute[] {
  const source = sourceFile({ file });
  const routes: UiRoute[] = [];
  const walk = (node: ts.Expression, parent: string): void => {
    const value = unwrap(node);
    if (ts.isArrayLiteralExpression(value)) {
      for (const element of value.elements) walk(element, parent);

      return;
    }
    if (!ts.isObjectLiteralExpression(value)) return;
    const fields = new Map(
      properties({ expression: value, source, reading }).map((item) => [item.key, item.value]),
    );
    const path = fields.get("path");
    const folded = path ? fold({ expression: path, source, reading }) : void 0;
    const own = folded?.resolved ? folded.value : "";
    const full =
      own.startsWith("/") || !own ? own || parent : `${parent.replace(/\/$/, "")}/${own}`;
    const page = fields.get("page");
    if (page && ts.isStringLiteral(unwrap(page)) && !fields.has("redirect"))
      routes.push({
        page: (unwrap(page) as ts.StringLiteral).text,
        path: folded && !folded.resolved ? "" : full,
      });
    const children = fields.get("children");
    if (children) walk(children, full);
  };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "uiRouteTable" &&
        declaration.initializer
      )
        walk(declaration.initializer, "");
  }

  return routes;
}
