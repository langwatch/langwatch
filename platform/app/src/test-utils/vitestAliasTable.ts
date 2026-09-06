import { dirname, join, resolve } from "node:path";
import type {
  CallExpression,
  Expression,
  Node,
  ObjectLiteralElementLike,
} from "typescript/unstable/ast";
import {
  isArrayLiteralExpression,
  isCallExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isStringLiteral,
} from "typescript/unstable/ast";
import { parseSourceText } from "./tsAst";

/**
 * Reading the module-alias tables the vitest configs declare.
 *
 * The tables are read out of the configs themselves rather than copied, so a
 * table that gains or renames an entry travels with the config instead of
 * going stale in a second place. Used by `mockSpecifierScan` to resolve a
 * mock specifier the way the runner would.
 *
 * Spec: specs/setup/test-mock-specifier-resolution.feature
 */

/** One entry of a vitest config's module-alias table. */
export type ModuleAlias = {
  /** The specifier prefix to match. */
  find: string;
  /** The absolute path it expands to. */
  replacement: string;
};

/** Where one alias entry is being read from, for the throw messages. */
type AliasReadContext = { fileName: string; configDir: string };

/** The name a call expression invokes, for `join(...)` and `path.join(...)` alike. */
function calleeName(node: CallExpression): string | undefined {
  const callee = node.expression;
  if (isPropertyAccessExpression(callee)) return callee.name.text;
  if (isIdentifier(callee)) return callee.text;
  return undefined;
}

/** The literal path segments a call passes after `__dirname`. */
function pathSegmentsAfterDirname({
  node,
}: {
  node: CallExpression;
}): string[] | undefined {
  const [base, ...rest] = node.arguments;
  if (!base || !isIdentifier(base) || base.text !== "__dirname") {
    return undefined;
  }
  const segments: string[] = [];
  for (const argument of rest) {
    if (!isStringLiteral(argument)) return undefined;
    segments.push(argument.text);
  }
  return segments;
}

/** The string a config's path-building call produces, e.g. `join(__dirname, "./src/")`. */
function pathCallValue({
  node,
  configDir,
}: {
  node: CallExpression;
  configDir: string;
}): string | undefined {
  const name = calleeName(node);
  if (name !== "join" && name !== "resolve") return undefined;

  const segments = pathSegmentsAfterDirname({ node });
  if (!segments) return undefined;

  // Expand with the function the config actually called. The two part company
  // on an absolute segment: `join(dir, "/src")` keeps the directory, while
  // `resolve(dir, "/src")` discards everything before it.
  const expanded = (name === "join" ? join : resolve)(configDir, ...segments);

  // A trailing separator is load-bearing: it is what makes `"~/"` expand to a
  // directory rather than glue the rest of the specifier onto the directory's
  // name. `join` keeps one, `resolve` drops it.
  if (!segments.at(-1)?.endsWith("/")) return expanded;
  return expanded.endsWith("/") ? expanded : `${expanded}/`;
}

/** The key and value of one `"key": value` entry, or undefined for any other shape. */
function simpleEntryOf({
  property,
}: {
  property: ObjectLiteralElementLike;
}): { key: string; value: Expression } | undefined {
  if (!isPropertyAssignment(property)) return undefined;
  const name = property.name;
  if (
    !isStringLiteral(name) &&
    !isIdentifier(name) &&
    !isNoSubstitutionTemplateLiteral(name)
  ) {
    return undefined;
  }
  return { key: name.text, value: property.initializer };
}

/** The path one alias entry's value expands to, or undefined when unreadable. */
function aliasReplacementOf({
  value,
  configDir,
}: {
  value: Expression;
  configDir: string;
}): string | undefined {
  if (isStringLiteral(value)) return value.text;
  if (isCallExpression(value)) {
    return pathCallValue({ node: value, configDir });
  }
  return undefined;
}

/** The property named `alias`, whatever shape its table takes. */
function aliasTableOf({ node }: { node: Node }): Expression | undefined {
  if (!isPropertyAssignment(node)) return undefined;
  if (!isIdentifier(node.name) && !isStringLiteral(node.name)) {
    return undefined;
  }
  return node.name.text === "alias" ? node.initializer : undefined;
}

/** One `"key": value` entry of the object-shaped table. */
function readObjectEntry({
  property,
  fileName,
  configDir,
}: AliasReadContext & {
  property: ObjectLiteralElementLike;
}): ModuleAlias {
  const entry = simpleEntryOf({ property });
  if (!entry) {
    throw new Error(
      `${fileName}: alias entry is not a simple "key": value pair`,
    );
  }
  const replacement = aliasReplacementOf({ value: entry.value, configDir });
  if (replacement === undefined) {
    throw new Error(
      `${fileName}: alias "${entry.key}" is built in a way this scanner cannot read`,
    );
  }
  return { find: entry.key, replacement };
}

/** The properties of one array-shaped entry, keyed by name. */
function entryPropertiesOf({
  element,
  fileName,
}: {
  element: Expression;
  fileName: string;
}): Map<string, Expression> {
  if (!isObjectLiteralExpression(element)) {
    throw new Error(`${fileName}: alias array entry is not an object literal`);
  }
  const parts = new Map<string, Expression>();
  for (const property of element.properties) {
    const entry = simpleEntryOf({ property });
    if (!entry) {
      throw new Error(
        `${fileName}: alias array entry is not a simple "key": value pair`,
      );
    }
    parts.set(entry.key, entry.value);
  }
  return parts;
}

/** One `{ find, replacement }` entry of vite's other accepted table shape. */
function readArrayEntry({
  element,
  fileName,
  configDir,
}: AliasReadContext & { element: Expression }): ModuleAlias {
  const parts = entryPropertiesOf({ element, fileName });

  const extra = [...parts.keys()].filter(
    (key) => key !== "find" && key !== "replacement",
  );
  if (extra.length > 0) {
    // `customResolver` in particular can send a specifier anywhere, so an
    // entry carrying one cannot be resolved by prefix substitution.
    throw new Error(
      `${fileName}: alias array entry carries ${extra.join(", ")}, which this scanner cannot read`,
    );
  }

  const find = parts.get("find");
  const replacementValue = parts.get("replacement");
  if (!find || !replacementValue) {
    throw new Error(
      `${fileName}: alias array entry is missing find or replacement`,
    );
  }
  if (!isStringLiteral(find)) {
    // A regular-expression `find` is legal here and cannot be prefix-matched.
    throw new Error(
      `${fileName}: alias array entry's find is not a string literal`,
    );
  }

  const replacement = aliasReplacementOf({
    value: replacementValue,
    configDir,
  });
  if (replacement === undefined) {
    throw new Error(
      `${fileName}: alias "${find.text}" is built in a way this scanner cannot read`,
    );
  }
  return { find: find.text, replacement };
}

/**
 * Every entry of one alias table, in whichever of the two shapes it takes,
 * in the order it is declared. Order is the precedence: vite applies the
 * first entry that matches, not the most specific one.
 */
function readAliasTable({
  table,
  fileName,
  configDir,
}: AliasReadContext & { table: Expression }): ModuleAlias[] {
  if (isObjectLiteralExpression(table)) {
    return table.properties.map((property) =>
      readObjectEntry({ property, fileName, configDir }),
    );
  }
  if (isArrayLiteralExpression(table)) {
    return table.elements.map((element) =>
      readArrayEntry({ element, fileName, configDir }),
    );
  }
  throw new Error(
    `${fileName}: alias table is neither an object nor an array literal`,
  );
}

/**
 * The module-alias table one vitest config declares, in either shape vite
 * accepts: `alias: { "~/": ... }` or `alias: [{ find, replacement }]`.
 *
 * Throws on anything it cannot read rather than skipping it. A dropped alias
 * is the worse failure of the two available: the specifiers relying on it
 * stop looking like paths, get taken for package names, and are skipped, so
 * the scanner goes quiet about exactly the files it was meant to check.
 */
export function parseVitestConfigAliases({
  fileName,
  sourceText,
  configDir,
}: {
  fileName: string;
  sourceText: string;
  configDir: string;
}): ModuleAlias[] {
  const source = parseSourceText({ fileName, sourceText });
  const aliases: ModuleAlias[] = [];

  // `resolve.alias` and `test.alias` are both honoured by vitest, so take
  // the table wherever it is declared.
  const visit = (node: Node): void => {
    if (isCallExpression(node) && calleeName(node) === "mergeConfig") {
      // The aliases would then be partly in whatever config is merged in, and
      // reading only this file would silently under-resolve every specifier
      // relying on them.
      throw new Error(
        `${fileName}: the config is composed with mergeConfig, so its alias table is not all in this file`,
      );
    }
    const table = aliasTableOf({ node });
    if (table) {
      aliases.push(...readAliasTable({ table, fileName, configDir }));
    }
    node.forEachChild(visit);
  };
  visit(source);

  return aliases;
}

/**
 * The alias table in force for a file: the nearest vitest config above it
 * wins, because that is the config whose resolver would run its suite.
 */
export function aliasesForFile({
  file,
  aliasesByConfigDir,
}: {
  file: string;
  aliasesByConfigDir: Map<string, ModuleAlias[]>;
}): ModuleAlias[] {
  let directory = dirname(file);
  for (;;) {
    const found = aliasesByConfigDir.get(directory);
    if (found) return found;
    const parent = dirname(directory);
    if (parent === directory) return [];
    directory = parent;
  }
}
