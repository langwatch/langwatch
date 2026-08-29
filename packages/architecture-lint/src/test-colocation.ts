import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { walkFiles } from "./files";
import { discoverClassifiedPackages } from "./workspace";

/**
 * Moving a feature package's `tests/` tree into `__tests__` directories beside
 * the code each test covers.
 *
 * WHY THIS EXISTS
 *
 * A package-root `tests/` tree is a MIRROR of `src/`, and a mirror is only
 * accurate while someone maintains it by hand. Rename a directory in `src` and
 * the mirror silently stops matching; move a service and its test stays where
 * it was, still passing, now describing a file two directories away. Nothing
 * fails. The connection between a test and its subject lives in a convention
 * rather than in the filesystem, so it decays quietly.
 *
 * `__tests__` beside the subject puts the connection where a rename cannot
 * miss it: move the directory and the tests move with it.
 *
 * HOW A TEST'S SUBJECT IS FOUND
 *
 * Not from the path — that is the mirror this exists to stop trusting — but
 * from the test's own imports. A test imports what it tests, so the subject is
 * whichever `src` module it reaches for, and the destination is that module's
 * directory. Where a test names several, {@link chooseSubject} picks by name
 * agreement, then by directory agreement with the old mirror path, and a test
 * that names none at all is reported UNRESOLVED rather than guessed at.
 *
 * The plan is a plan: it computes every move, every rewritten specifier and
 * every collision without touching a file, so the whole thing can be read
 * before any of it is applied.
 */

export type TestMove = {
  /** Absolute path the test lives at now. */
  from: string;
  /** Absolute path it belongs at, in a `__tests__` beside its subject. */
  to: string;
  /** The `src` module whose directory decided the destination. */
  subject: string;
};

export type TestColocationPlan = {
  moves: TestMove[];
  /**
   * Files whose subject could not be read off their imports, with the reason.
   * These are LEFT ALONE: a test moved to a guessed home is worse than a test
   * that stayed put, because the guess looks deliberate afterwards.
   */
  unresolved: Array<{ file: string; reason: string }>;
  /** Two files that would land on one path, which no move should do. */
  collisions: string[];
  /** New content, keyed by absolute path, for every file whose imports change. */
  edits: Map<string, string>;
};

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function workspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

/** Every module specifier the TypeScript grammar treats as one. */
function moduleSpecifierNodes(sourceFile: ts.SourceFile): ts.StringLiteral[] {
  const literals: ts.StringLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isStringLiteral(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    const parent = node.parent;
    const isImport = ts.isImportDeclaration(parent) && parent.moduleSpecifier === node;
    const isExport = ts.isExportDeclaration(parent) && parent.moduleSpecifier === node;
    const isImportType =
      ts.isImportTypeNode(parent) &&
      ts.isLiteralTypeNode(parent.argument) &&
      parent.argument.literal === node;
    const isDynamic =
      ts.isCallExpression(parent) &&
      parent.arguments[0] === node &&
      (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(parent.expression) && parent.expression.text === "require"));
    const isMockPath =
      ts.isCallExpression(parent) &&
      parent.arguments[0] === node &&
      ts.isPropertyAccessExpression(parent.expression) &&
      ts.isIdentifier(parent.expression.name) &&
      ["mock", "doMock", "unmock", "importActual", "importMock"].includes(
        parent.expression.name.text,
      );
    if (isImport || isExport || isImportType || isDynamic || isMockPath) literals.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return literals;
}

/** The file a relative specifier names, if one exists on disk. */
function relativeModuleTarget(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return void 0;
  const base = resolve(dirname(file), specifier);
  const javascriptExtension = specifier.match(/\.(?:m?js|cjs)$/)?.[0];
  const extensionless = javascriptExtension
    ? base.slice(0, -javascriptExtension.length)
    : base;
  const candidates = [
    ...(javascriptExtension ? [] : [base]),
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].map(
      (extension) => `${extensionless}${extension}`,
    ),
    ...[".ts", ".tsx", ".js", ".jsx"].map((extension) => `${base}/index${extension}`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return void 0;
}

/**
 * The `src` module a SELF-REFERENCING import names.
 *
 * A test often reaches its subject through the package's own name rather than
 * a relative path — `@langwatch/langy-server/eventing/langy-conversation-processing`
 * rather than `../src/eventing/...`. Node resolves that through the package's
 * `exports` map, which for these packages points straight back into `src`, so
 * the subpath after the package name is a path under `src` and the subject is
 * exactly as knowable as it is for a relative import.
 *
 * Reading it matters more than it looks: 188 of the 1292 test files in the
 * workspace name their subject ONLY this way, and treating those as
 * unresolvable would leave a sixth of the suite in the mirror tree for no
 * reason other than the spelling of an import.
 */
function selfReferenceTarget(input: {
  specifier: string;
  packageName: string;
  packageRoot: string;
  exportsMap: Record<string, unknown> | undefined;
}): string | undefined {
  const { specifier, packageName, packageRoot, exportsMap } = input;
  if (specifier !== packageName && !specifier.startsWith(`${packageName}/`)) return void 0;
  const subpath = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;

  const declared = exportsMap?.[subpath];
  const fromExports =
    typeof declared === "string"
      ? declared
      : typeof declared === "object" && declared !== null
        ? ((declared as Record<string, unknown>).default ??
          (declared as Record<string, unknown>).types)
        : void 0;
  if (typeof fromExports === "string") {
    const resolved = resolve(packageRoot, fromExports);
    if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  }

  const base = subpath === "." ? `${packageRoot}/src/index` : `${packageRoot}/src/${subpath.slice(2)}`;
  for (const candidate of [
    base,
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) => `${base}${extension}`),
    ...[".ts", ".tsx"].map((extension) => `${base}/index${extension}`),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return void 0;
}

/** A filename with its extension and every dotted qualifier removed. */
function subjectStem(path: string): string {
  return basename(path).replace(SOURCE_FILE, "").split(".")[0] ?? "";
}

/**
 * Which `src` module a test is about, given every one it imports.
 *
 * A test that imports one module is unambiguous. Where it imports several, the
 * tie-breaks are, in order:
 *
 *   1. **Name agreement.** `prompt.service.unit.test.ts` beside an import of
 *      `services/prompt.service.ts` is the subject, whatever else it imports —
 *      a test's name is the strongest statement anyone makes about what it
 *      covers.
 *   2. **Directory agreement with the mirror.** The old tree encoded a real
 *      intention, and where the two agree there is no reason to overrule it:
 *      `tests/services/x.test.ts` importing from `src/services/` keeps that.
 *   3. **The most-imported directory**, which is the one the test spends its
 *      assertions on.
 *
 * Ties inside a step fall through to the next; a tie at the end is resolved by
 * path order, so the plan is deterministic.
 */
export function chooseSubject(
  testFile: string,
  mirrorPath: string,
  imports: readonly string[],
): string | undefined {
  if (imports.length === 0) return void 0;
  const sorted = [...imports].sort();

  const stem = subjectStem(testFile);
  const named = sorted.filter((target) => subjectStem(target) === stem);
  if (named.length > 0) return named[0];

  const mirrorDirectory = dirname(mirrorPath);
  if (mirrorDirectory !== ".") {
    const agreeing = sorted.filter((target) =>
      dirname(target).endsWith(`/${mirrorDirectory}`),
    );
    if (agreeing.length > 0) return agreeing[0];
  }

  const byDirectory = new Map<string, number>();
  for (const target of sorted) {
    byDirectory.set(dirname(target), (byDirectory.get(dirname(target)) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const target of sorted) {
    const count = byDirectory.get(dirname(target)) ?? 0;
    if (count > bestCount) {
      best = target;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Rewrites every relative specifier in `source` for a file that is moving from
 * `from` to `to`.
 *
 * A specifier is resolved against the OLD directory and re-expressed against
 * the new one, so it keeps naming the same file. `moved` carries the other
 * files moving in the same plan — a test importing a helper that is itself
 * moving has to follow the helper to its destination, not to where it used to
 * be.
 *
 * The extension the author wrote is preserved: an extensionless specifier stays
 * extensionless, and a `.js` specifier stays `.js`, because in an ESM package
 * that spelling is what resolves at runtime.
 */
export function rewriteRelativeSpecifiers(input: {
  from: string;
  to: string;
  source: string;
  moved: ReadonlyMap<string, string>;
}): string {
  const { from, to, source, moved } = input;
  const sourceFile = ts.createSourceFile(from, source, ts.ScriptTarget.Latest, true);
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  for (const literal of moduleSpecifierNodes(sourceFile)) {
    const target = relativeModuleTarget(from, literal.text);
    if (!target) continue;
    const destination = moved.get(target) ?? target;
    let next = relative(dirname(to), destination).split(sep).join("/");
    if (!next.startsWith(".")) next = `./${next}`;
    const writtenExtension = literal.text.match(/\.[cm]?[jt]sx?$/)?.[0];
    if (!writtenExtension) next = next.replace(SOURCE_FILE, "");
    else if (/\.(?:m?js|cjs)$/.test(writtenExtension)) {
      next = next.replace(SOURCE_FILE, writtenExtension);
    }
    if (next === literal.text) continue;
    replacements.push({
      start: literal.getStart(sourceFile) + 1,
      end: literal.getEnd() - 1,
      text: next,
    });
  }

  if (replacements.length === 0) return source;
  let output = source;
  for (const replacement of [...replacements].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  return output;
}

/**
 * Where one file under a package's `tests/` tree belongs.
 *
 * Every file moves, not only the `*.test.ts` ones: a helper left behind in
 * `tests/support/` would be imported from a directory that no longer holds any
 * tests. A test goes beside its subject; a helper goes beside the tests that
 * use it, which is decided by the same rule applied to its own imports, and
 * failing that by the tests importing IT.
 */
function planPackage(
  packageRoot: string,
  packageName: string,
  exportsMap: Record<string, unknown> | undefined,
  helperDestinations: ReadonlyMap<string, string>,
): { moves: TestMove[]; unresolved: Array<{ file: string; reason: string }> } {
  const testsRoot = `${packageRoot}/tests`;
  const sourceRoot = resolve(`${packageRoot}/src`);
  const moves: TestMove[] = [];
  const unresolved: Array<{ file: string; reason: string }> = [];

  for (const file of walkFiles(testsRoot, (path) => SOURCE_FILE.test(path))) {
    const mirrorPath = workspacePath(testsRoot, file);
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    for (const literal of moduleSpecifierNodes(sourceFile)) {
      const target =
        relativeModuleTarget(file, literal.text) ??
        selfReferenceTarget({
          specifier: literal.text,
          packageName,
          packageRoot,
          exportsMap,
        });
      if (target && resolve(target).startsWith(`${sourceRoot}${sep}`)) imports.push(target);
    }

    const subject = chooseSubject(file, mirrorPath, imports);
    if (subject) {
      // A TEST lands directly in the __tests__ beside its subject. Anything
      // else — a fixture, a helper — keeps its path under tests/, because its
      // directory is what distinguishes it: three fixture directories each
      // holding an `index.ts` are three files, and flattening them into one
      // __tests__ would silently make them one.
      const leaf = TEST_FILE.test(file) ? basename(file) : mirrorPath;
      moves.push({ from: file, to: `${dirname(subject)}/__tests__/${leaf}`, subject });
      continue;
    }

    // A helper names nothing under src/ — that is what makes it a helper. It
    // follows the tests that import it instead, into the same __tests__,
    // KEEPING its path under tests/ rather than being flattened into it: three
    // fixture directories each holding an `index.ts` are three files, and
    // flattening them would silently make them one.
    const helperDestination = helperDestinations.get(file);
    if (helperDestination) {
      moves.push({
        from: file,
        to: `${helperDestination}/${mirrorPath}`,
        subject: helperDestination,
      });
      continue;
    }

    unresolved.push({
      file,
      reason: TEST_FILE.test(file)
        ? "names no module under src/, by any path or by the package's own name, so nothing says what it covers"
        : "is a helper no relocated test imports",
    });
  }

  return { moves, unresolved };
}

type MirroredPackage = {
  root: string;
  name: string;
  exportsMap: Record<string, unknown> | undefined;
};

/** Every strict feature package that still keeps its tests in a mirror tree. */
function packagesWithMirroredTests(root: string): MirroredPackage[] {
  const { packages } = discoverClassifiedPackages(root);
  return packages
    .filter((pkg) => ["contract", "server", "web"].includes(pkg.kind))
    .filter((pkg) => existsSync(`${pkg.root}/tests`))
    .map((pkg) => ({
      root: pkg.root,
      name: pkg.name,
      exportsMap: (pkg.manifest as { exports?: Record<string, unknown> } | undefined)?.exports,
    }))
    .sort((left, right) => left.root.localeCompare(right.root));
}

export function planTestColocation(rootInput: string): TestColocationPlan {
  const root = resolve(rootInput);
  const moves: TestMove[] = [];
  const unresolved: Array<{ file: string; reason: string }> = [];

  for (const { root: packageRoot, name, exportsMap } of packagesWithMirroredTests(root)) {
    // Two passes: the first resolves the tests, the second places any helper
    // whose own imports said nothing beside the tests that import it.
    const first = planPackage(packageRoot, name, exportsMap, new Map());
    const testsRoot = `${resolve(packageRoot)}/tests`;
    const helperDestinations = new Map<string, string>();
    for (const { from, to } of first.moves) {
      const source = readFileSync(from, "utf8");
      const sourceFile = ts.createSourceFile(from, source, ts.ScriptTarget.Latest, true);
      for (const literal of moduleSpecifierNodes(sourceFile)) {
        const target = relativeModuleTarget(from, literal.text);
        if (!target || !resolve(target).startsWith(`${testsRoot}${sep}`)) continue;
        // The helper lands in the __tests__ of the first test that uses it.
        // Deterministic because `first.moves` is walked in sorted path order.
        if (!helperDestinations.has(target)) helperDestinations.set(target, dirname(to));
      }
    }
    const second = planPackage(packageRoot, name, exportsMap, helperDestinations);
    moves.push(...second.moves);
    unresolved.push(...second.unresolved);
  }

  const byDestination = new Map<string, string>();
  const collisions: string[] = [];
  for (const move of moves) {
    const owner = byDestination.get(move.to);
    if (owner) collisions.push(`${owner} and ${move.from} both target ${move.to}`);
    else byDestination.set(move.to, move.from);
  }

  const moved = new Map(moves.map((move) => [move.from, move.to]));
  const edits = new Map<string, string>();
  for (const move of moves) {
    const output = rewriteRelativeSpecifiers({
      from: move.from,
      to: move.to,
      source: readFileSync(move.from, "utf8"),
      moved,
    });
    edits.set(move.from, output);
  }

  return { moves, unresolved, collisions, edits };
}
