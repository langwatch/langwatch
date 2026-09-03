import { dirname, join, resolve } from "node:path";
import type {
  CallExpression,
  Expression,
  NewExpression,
  Node,
  ObjectLiteralElementLike,
} from "typescript/unstable/ast";
import {
  isArrayLiteralExpression,
  isCallExpression,
  isIdentifier,
  isMetaProperty,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isRegularExpressionLiteral,
  isStringLiteral,
} from "typescript/unstable/ast";
import { parseSourceText } from "./ts-ast";

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
  /**
   * Whether the entry claims only the bare specifier, never a subpath under
   * it. An anchored regular-expression `find` is how a config says that, and
   * it says it for a reason: mapping a package name to one file by prefix
   * turns `@langwatch/observability/metrics` into
   * `…/observability/src/index.ts/metrics`, which is an `ENOTDIR` rather than
   * a module. Absent, the entry matches vite's ordinary rule — the exact
   * specifier, or a prefix ending at a path boundary.
   */
  exact?: boolean;
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
function pathSegmentsAfterDirname({ node }: { node: CallExpression }): string[] | undefined {
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

/** Whether an expression is `import.meta.url`, the base every config's URL takes. */
function isImportMetaUrl(node: Expression): boolean {
  return (
    isPropertyAccessExpression(node) && node.name.text === "url" && isMetaProperty(node.expression)
  );
}

/** The literal specifier one `new URL("…", import.meta.url)` carries. */
function urlSpecifierOf(node: NewExpression): string | undefined {
  if (!isIdentifier(node.expression) || node.expression.text !== "URL") return undefined;
  const [specifier, base] = node.arguments ?? [];
  if (!specifier || !isStringLiteral(specifier)) return undefined;
  if (!base || !isImportMetaUrl(base)) return undefined;
  return specifier.text;
}

/**
 * The path a `new URL(…, import.meta.url)` resolves to, whether the config
 * unwraps it with `fileURLToPath` or reads `.pathname` off it.
 *
 * `import.meta.url` is the config file, and a relative URL resolves against
 * the file's directory, which is the config's own directory. A trailing
 * separator is kept for the same reason `join` keeps one: it is what makes an
 * entry expand to a directory rather than glue the rest of the specifier onto
 * the directory's name.
 */
function urlCallValue({
  node,
  configDir,
}: {
  node: NewExpression;
  configDir: string;
}): string | undefined {
  const specifier = urlSpecifierOf(node);
  if (specifier === undefined) return undefined;
  const expanded = resolve(configDir, specifier);
  if (!specifier.endsWith("/")) return expanded;
  return expanded.endsWith("/") ? expanded : `${expanded}/`;
}

/**
 * The exact specifier an anchored regular-expression `find` names, or
 * undefined for any pattern that is not one literal specifier.
 *
 * `/^@langwatch\/eventing$/` is a package name spelled as a regex, which is
 * how a config asks for an exact match. Anything with a character class, a
 * quantifier, an alternation or a flag is a real pattern, cannot be reduced to
 * a prefix, and is refused rather than guessed at.
 */
function anchoredExactFindOf(node: Expression): string | undefined {
  if (!isRegularExpressionLiteral(node)) return undefined;
  const text = node.text;
  const end = text.lastIndexOf("/");
  if (end <= 0 || text.slice(end + 1) !== "") return undefined;
  const body = text.slice(1, end);
  if (!body.startsWith("^") || !body.endsWith("$")) return undefined;

  const inner = body.slice(1, -1);
  let literal = "";
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index]!;
    if (character === "\\") {
      const escaped = inner[index + 1];
      // `\d`, `\w`, `\1` and friends are classes and backreferences, not the
      // character they spell.
      if (escaped === undefined || /[a-zA-Z0-9]/.test(escaped)) return undefined;
      literal += escaped;
      index += 1;
      continue;
    }
    if ("^$.*+?()[]{}|/".includes(character)) return undefined;
    literal += character;
  }
  return literal;
}

/** The key and value of one `"key": value` entry, or undefined for any other shape. */
function simpleEntryOf({
  property,
}: {
  property: ObjectLiteralElementLike;
}): { key: string; value: Expression } | undefined {
  if (!isPropertyAssignment(property)) return undefined;
  const name = property.name;
  if (!isStringLiteral(name) && !isIdentifier(name) && !isNoSubstitutionTemplateLiteral(name)) {
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
    const [argument] = value.arguments;
    if (calleeName(value) === "fileURLToPath" && argument && isNewExpression(argument)) {
      return urlCallValue({ node: argument, configDir });
    }
    return pathCallValue({ node: value, configDir });
  }
  // `new URL("…", import.meta.url).pathname`, the other way a config spells
  // the same thing.
  if (
    isPropertyAccessExpression(value) &&
    value.name.text === "pathname" &&
    isNewExpression(value.expression)
  ) {
    return urlCallValue({ node: value.expression, configDir });
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
    throw new Error(`${fileName}: alias entry is not a simple "key": value pair`);
  }
  const replacement = aliasReplacementOf({ value: entry.value, configDir });
  if (replacement === undefined) {
    throw new Error(`${fileName}: alias "${entry.key}" is built in a way this scanner cannot read`);
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
      throw new Error(`${fileName}: alias array entry is not a simple "key": value pair`);
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

  const extra = [...parts.keys()].filter((key) => key !== "find" && key !== "replacement");
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
    throw new Error(`${fileName}: alias array entry is missing find or replacement`);
  }
  const exactFind = isStringLiteral(find) ? undefined : anchoredExactFindOf(find);
  if (!isStringLiteral(find) && exactFind === undefined) {
    // A pattern `find` that is not one anchored literal cannot be prefix-matched.
    throw new Error(`${fileName}: alias array entry's find is not a string literal`);
  }
  const findText = isStringLiteral(find) ? find.text : exactFind!;

  const replacement = aliasReplacementOf({
    value: replacementValue,
    configDir,
  });
  if (replacement === undefined) {
    throw new Error(`${fileName}: alias "${findText}" is built in a way this scanner cannot read`);
  }
  return exactFind === undefined
    ? { find: findText, replacement }
    : { find: findText, replacement, exact: true };
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
    return table.properties.map((property) => readObjectEntry({ property, fileName, configDir }));
  }
  if (isArrayLiteralExpression(table)) {
    return table.elements.map((element) => readArrayEntry({ element, fileName, configDir }));
  }
  throw new Error(`${fileName}: alias table is neither an object nor an array literal`);
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
